import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { REDACTED } from "@/modules/audit/redact";
import { tenantWhere, leadWhere, noteWhere, type ScopeContext } from "@/lib/scope";
import { listPartnerActivity } from "@/modules/activity/queries";
import { findProfileById } from "@/modules/sources/profile-store";

// TST-01 runs against a live Postgres (the dev DB locally; a service container in
// CI). It self-skips when DATABASE_URL is unset so the fast unit suite stays green.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const SLUG_A = "test-iso-a";
const SLUG_B = "test-iso-b";

suite("TST-01: tenant & partner isolation", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenantsToClear = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG_A, SLUG_B]));
    const tids = tenantsToClear.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadNotes).where(inArray(schema.leadNotes.tenantId, tids));
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
    // editLead writes an audit_log row (action "lead.edited"); clear it before tenants.
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
    await db.delete(schema.sourceProfiles).where(inArray(schema.sourceProfiles.tenantId, tids));
    await db.delete(schema.users).where(inArray(schema.users.tenantId, tids));
    await db.delete(schema.partners).where(inArray(schema.partners.tenantId, tids));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();

    const [ta] = await db.insert(schema.tenants).values({ name: "Iso A", slug: SLUG_A }).returning({ id: schema.tenants.id });
    const [tb] = await db.insert(schema.tenants).values({ name: "Iso B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantA = ta.id;
    id.tenantB = tb.id;

    const [px] = await db.insert(schema.partners).values({ tenantId: ta.id, refId: "JV-001", name: "PX", color: "#111111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: ta.id, refId: "JV-002", name: "PY", color: "#222222", status: "active" }).returning({ id: schema.partners.id });
    const [pz] = await db.insert(schema.partners).values({ tenantId: tb.id, refId: "JV-001", name: "PZ", color: "#333333", status: "active" }).returning({ id: schema.partners.id });
    id.partnerX = px.id;
    id.partnerY = py.id;
    id.partnerZ = pz.id;

    id.adminUser = randomUUID();
    id.partnerUser = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: ta.id, email: "admin@a.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.partnerUser, tenantId: ta.id, email: "px@a.test", role: "partner", partnerId: px.id });

    const [ua] = await db.insert(schema.uploads).values({ tenantId: ta.id, refId: "IM-26-001", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    id.uploadA = ua.id;
    const [ub] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "IM-26-001", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });

    // C-8 / WP-TSK-2a: partnerX reads its partner note on lx via noteWhere (PRN-13), which now
    // carries the distribution hold — so lx must be seeded past the hold window (released).
    const [lx] = await db.insert(schema.leads).values({ tenantId: ta.id, refId: "LD-26-00001", uploadId: ua.id, dedupeKey: "x|00001", rawJson: {}, partnerId: px.id, matchMethod: "zip", createdAt: new Date(Date.now() - 20 * 60 * 1000) }).returning({ id: schema.leads.id });
    const [ly] = await db.insert(schema.leads).values({ tenantId: ta.id, refId: "LD-26-00002", uploadId: ua.id, dedupeKey: "y|00002", rawJson: {}, partnerId: py.id, matchMethod: "zip" }).returning({ id: schema.leads.id });
    const [lz] = await db.insert(schema.leads).values({ tenantId: tb.id, refId: "LD-26-00001", uploadId: ub.id, dedupeKey: "z|00003", rawJson: {}, partnerId: pz.id, matchMethod: "zip" }).returning({ id: schema.leads.id });
    // An unmatched lead in tenant A, manually assigned to partner Y (ASN-03).
    const [lm] = await db
      .insert(schema.leads)
      .values({ tenantId: ta.id, refId: "LD-26-00009", uploadId: ua.id, dedupeKey: "m|00009", rawJson: {}, partnerId: null, matchMethod: "none", manualPartnerId: py.id, manualAssignedAt: new Date(), manualAssignedBy: id.adminUser })
      .returning({ id: schema.leads.id });
    // A MATCHED lead (pipeline partner X) later re-routed to Y via the manual overlay.
    // Effective owner is Y; X must LOSE access (audit F-01 divergence case).
    const [lr] = await db
      .insert(schema.leads)
      .values({ tenantId: ta.id, refId: "LD-26-00010", uploadId: ua.id, dedupeKey: "r|00010", rawJson: {}, partnerId: px.id, matchMethod: "zip", manualPartnerId: py.id, manualAssignedAt: new Date(), manualAssignedBy: id.adminUser })
      .returning({ id: schema.leads.id });
    id.leadX = lx.id;
    id.leadY = ly.id;
    id.leadZ = lz.id;
    id.leadManualToY = lm.id;
    id.leadReroutedXtoY = lr.id;

    await db.insert(schema.leadNotes).values({ tenantId: ta.id, leadId: lx.id, authorUserId: id.adminUser, authorRole: "admin", body: "admin-only note" });
    await db.insert(schema.leadNotes).values({ tenantId: ta.id, leadId: lx.id, authorUserId: id.partnerUser, authorRole: "partner", body: "partner-only note" });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const adminA = (): ScopeContext => ({ tenantId: id.tenantA, role: "admin", userId: id.adminUser });
  const partnerX = (): ScopeContext => ({ tenantId: id.tenantA, role: "partner", userId: id.partnerUser, partnerId: id.partnerX });
  const partnerY = (): ScopeContext => ({ tenantId: id.tenantA, role: "partner", userId: id.partnerUser, partnerId: id.partnerY });

  it("tenant scope returns only that tenant's leads (never the other tenant's)", async () => {
    const rows = await db.select({ id: schema.leads.id }).from(schema.leads).where(tenantWhere(schema.leads, adminA()));
    const got = rows.map((r) => r.id);
    expect(got).toContain(id.leadX);
    expect(got).toContain(id.leadY);
    expect(got).not.toContain(id.leadZ);
  });

  it("partner scope returns only the partner's own leads (not a sibling partner's)", async () => {
    const rows = await db.select({ id: schema.leads.id }).from(schema.leads).where(leadWhere(partnerX()));
    const got = rows.map((r) => r.id);
    expect(got).toEqual([id.leadX]);
    expect(got).not.toContain(id.leadY);
    expect(got).not.toContain(id.leadZ);
  });

  it("admin sees all of their tenant's leads", async () => {
    const rows = await db.select({ id: schema.leads.id }).from(schema.leads).where(leadWhere(adminA()));
    const got = rows.map((r) => r.id).sort();
    expect(got).toEqual([id.leadX, id.leadY, id.leadManualToY, id.leadReroutedXtoY].sort());
  });

  it("ASN-03: a partner sees leads manually assigned to them", async () => {
    const rows = await db.select({ id: schema.leads.id }).from(schema.leads).where(leadWhere(partnerY()));
    const got = rows.map((r) => r.id);
    expect(got).toContain(id.leadManualToY); // manually assigned to Y
    expect(got).toContain(id.leadY); // and their pipeline-routed lead
  });

  it("ASN-03: a manual assignment to Y stays invisible to sibling partner X", async () => {
    const rows = await db.select({ id: schema.leads.id }).from(schema.leads).where(leadWhere(partnerX()));
    const got = rows.map((r) => r.id);
    expect(got).toEqual([id.leadX]);
    expect(got).not.toContain(id.leadManualToY);
  });

  it("F-01/TST-01: a re-routed lead (partnerId=X, manualPartnerId=Y) leaves X's scope and enters Y's", async () => {
    // The effective owner is Y, so re-routing REVOKES the original pipeline partner X.
    const xRows = await db.select({ id: schema.leads.id }).from(schema.leads).where(leadWhere(partnerX()));
    expect(xRows.map((r) => r.id)).not.toContain(id.leadReroutedXtoY);
    const yRows = await db.select({ id: schema.leads.id }).from(schema.leads).where(leadWhere(partnerY()));
    expect(yRows.map((r) => r.id)).toContain(id.leadReroutedXtoY);
  });

  it("PRN-13: admin sees admin notes only", async () => {
    const rows = await db.select({ body: schema.leadNotes.body }).from(schema.leadNotes).where(noteWhere(adminA(), db));
    const bodies = rows.map((r) => r.body);
    expect(bodies).toContain("admin-only note");
    expect(bodies).not.toContain("partner-only note");
  });

  it("PRN-13: partner sees their partner notes only", async () => {
    const rows = await db.select({ body: schema.leadNotes.body }).from(schema.leadNotes).where(noteWhere(partnerX(), db));
    const bodies = rows.map((r) => r.body);
    expect(bodies).toContain("partner-only note");
    expect(bodies).not.toContain("admin-only note");
  });

  it("F-01: editLead recomputes dedupeKey/addressNormalized and never rewrites partnerId/matchMethod (PRN-05)", async () => {
    const { editLead } = await import("@/modules/leads/commands");
    const [seed] = await db
      .insert(schema.leads)
      .values({ tenantId: id.tenantA, refId: "LD-26-00011", uploadId: id.uploadA, dedupeKey: "orig|00011", rawJson: {}, partnerId: id.partnerX, matchMethod: "zip", mlsStatus: "kept", address: "1 Old St", zip: "00011" })
      .returning({ id: schema.leads.id });
    await editLead(adminA(), { ref: "LD-26-00011", fields: { address: "42 New Rd", zip: "75201" }, partner: { action: "set", partnerId: id.partnerY } });
    const [row] = await db
      .select({ dedupeKey: schema.leads.dedupeKey, addrNorm: schema.leads.addressNormalized, partnerId: schema.leads.partnerId, matchMethod: schema.leads.matchMethod, manualPartnerId: schema.leads.manualPartnerId })
      .from(schema.leads)
      .where(eq(schema.leads.id, seed.id));
    expect(row.dedupeKey).toBe("42 new rd|75201"); // recomputed from the new address+zip
    expect(row.addrNorm).toBe("42 new rd");
    expect(row.partnerId).toBe(id.partnerX); // PRN-05: import snapshot untouched
    expect(row.matchMethod).toBe("zip"); // PRN-05: import snapshot untouched
    expect(row.manualPartnerId).toBe(id.partnerY); // overlay moved
  });

  it("SEC-05 / LGL-02: lead.edited masks seller PII in the append-only trail but keeps routing fields raw (DM-04)", async () => {
    const { editLead } = await import("@/modules/leads/commands");
    const [seed] = await db
      .insert(schema.leads)
      .values({
        tenantId: id.tenantA,
        refId: "LD-26-00012",
        uploadId: id.uploadA,
        dedupeKey: "pii|00012",
        rawJson: {},
        partnerId: id.partnerX,
        matchMethod: "zip",
        mlsStatus: "kept",
        sellerFirst: "Jane",
        sellerLast: "Doe",
        phone: "(856) 555-0100",
        email: "jane.doe@gmail.com",
        reasonForSelling: "Relocating for work",
        address: "848 Caton Ave",
        city: "Cherry Hill",
      })
      .returning({ id: schema.leads.id });

    // Change two PII fields (one edited, one cleared) and one routing field.
    await editLead(adminA(), {
      ref: "LD-26-00012",
      fields: { phone: "(555) 555-9999", email: "", reasonForSelling: "Divorce", address: "12 Elm St", city: "Camden" },
      partner: { action: "keep" },
    });

    // The leads row keeps the REAL new values (only the audit payload is masked).
    const [row] = await db
      .select({ phone: schema.leads.phone, email: schema.leads.email, address: schema.leads.address, city: schema.leads.city })
      .from(schema.leads)
      .where(eq(schema.leads.id, seed.id));
    expect(row.phone).toBe("(555) 555-9999");
    expect(row.email).toBeNull(); // cleared
    expect(row.address).toBe("12 Elm St"); // the real value lives on the lead, not the trail
    expect(row.city).toBe("Camden");

    const [edit] = await db
      .select({ before: schema.auditLog.before, after: schema.auditLog.after })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.tenantId, id.tenantA),
          eq(schema.auditLog.action, "lead.edited"),
          eq(schema.auditLog.entityRef, "LD-26-00012"),
        ),
      );
    const before = edit.before as Record<string, unknown>;
    const after = edit.after as Record<string, unknown>;

    // PII fields: masked to a presence sentinel — changed → REDACTED, cleared → null.
    expect(before.phone).toBe(REDACTED);
    expect(after.phone).toBe(REDACTED);
    expect(before.email).toBe(REDACTED);
    expect(after.email).toBeNull();
    expect(before.reasonForSelling).toBe(REDACTED);
    expect(after.reasonForSelling).toBe(REDACTED);
    // SEC-05/LGL-02: the STREET ADDRESS is PII (the retention sweep nulls it), so it is
    // masked too — this is the exact field that shipped unmasked and would otherwise sit
    // in the append-only trail forever after a void+purge.
    expect(before.address).toBe(REDACTED);
    expect(after.address).toBe(REDACTED);
    // COARSE location: raw old→new preserved (its change is the audit-relevant part).
    expect(before.city).toBe("Cherry Hill");
    expect(after.city).toBe("Camden");
    // SEC-05 / LGL-02: no raw seller PII anywhere in the append-only payload.
    const payload = JSON.stringify({ before, after });
    for (const leak of [
      "(856) 555-0100",
      "jane.doe@gmail.com",
      "Relocating for work",
      "(555) 555-9999",
      "Divorce",
      "848 Caton Ave", // the OLD street address — the field that shipped unmasked
      "12 Elm St", // and the new one
    ]) {
      expect(payload, `raw PII leaked into audit_log: ${leak}`).not.toContain(leak);
    }
  });

  it("ADM/PRN-05: unassign clears the manual overlay of an unmatched-base lead, leaving no effective owner (snapshot untouched)", async () => {
    const { editLead } = await import("@/modules/leads/commands");
    // Unmatched-base lead manually assigned to X (partnerId=null, overlay=X). Effective owner is X.
    const [seed] = await db
      .insert(schema.leads)
      .values({ tenantId: id.tenantA, refId: "LD-26-00013", uploadId: id.uploadA, dedupeKey: "un|00013", rawJson: {}, partnerId: null, matchMethod: "none", mlsStatus: "kept", manualPartnerId: id.partnerX, manualAssignedAt: new Date(), manualAssignedBy: id.adminUser })
      .returning({ id: schema.leads.id });

    await editLead(adminA(), { ref: "LD-26-00013", fields: {}, partner: { action: "unassign" } });

    const [row] = await db
      .select({ partnerId: schema.leads.partnerId, matchMethod: schema.leads.matchMethod, manualPartnerId: schema.leads.manualPartnerId, manualAssignedAt: schema.leads.manualAssignedAt })
      .from(schema.leads)
      .where(eq(schema.leads.id, seed.id));
    expect(row.manualPartnerId).toBeNull(); // overlay cleared → no effective owner
    expect(row.manualAssignedAt).toBeNull();
    expect(row.partnerId).toBeNull(); // PRN-05: import snapshot untouched (was null)
    expect(row.matchMethod).toBe("none"); // PRN-05: import snapshot untouched

    // The read model now reports the lead as unowned.
    const { getAdminLeadDetail } = await import("@/modules/leads/queries");
    const detail = await getAdminLeadDetail(adminA(), "LD-26-00013");
    expect(detail?.partner).toBeNull();
    expect(detail?.assignment.manual).toBe(false);
  });

  it("ADM/PRN-05: unassign is REJECTED for a pipeline-routed lead — the immutable snapshot is never rewritten", async () => {
    const { editLead, CannotUnassignRoutedLeadError } = await import("@/modules/leads/commands");
    // Pure pipeline routing to X (partnerId=X, no overlay). Its owner comes from the immutable
    // import snapshot, which PRN-05 forbids rewriting — so it cannot be unassigned.
    const [seed] = await db
      .insert(schema.leads)
      .values({ tenantId: id.tenantA, refId: "LD-26-00014", uploadId: id.uploadA, dedupeKey: "pl|00014", rawJson: {}, partnerId: id.partnerX, matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });

    await expect(
      editLead(adminA(), { ref: "LD-26-00014", fields: {}, partner: { action: "unassign" } }),
    ).rejects.toBeInstanceOf(CannotUnassignRoutedLeadError);

    const [row] = await db
      .select({ partnerId: schema.leads.partnerId, matchMethod: schema.leads.matchMethod, manualPartnerId: schema.leads.manualPartnerId })
      .from(schema.leads)
      .where(eq(schema.leads.id, seed.id));
    expect(row.partnerId).toBe(id.partnerX); // PRN-05: snapshot untouched
    expect(row.matchMethod).toBe("zip"); // PRN-05: snapshot untouched
    expect(row.manualPartnerId).toBeNull(); // no overlay written
  });

  it("F-01: the leads RLS policy uses the effective-owner coalesce form (DB backstop matches scope.ts)", async () => {
    const rows = (await db.execute<{ qual: string }>(sql`
      select qual from pg_policies where tablename = 'leads' and policyname = 'leads_scope'
    `)) as unknown as { qual: string }[];
    expect(String(rows[0]?.qual)).toContain("COALESCE(manual_partner_id, partner_id)");
  });

  it("R-22: the lead_status_history RLS policy carries the author predicate (DB backstop matches ownStatusAuthorScope, migration 0037)", async () => {
    const rows = (await db.execute<{ qual: string }>(sql`
      select qual from pg_policies where tablename = 'lead_status_history' and policyname = 'lead_status_history_scope'
    `)) as unknown as { qual: string }[];
    const qual = String(rows[0]?.qual);
    // Scoped by effective-owner lead-ownership AND — the R-22 addition — the author org, so the DB
    // backstop hides a prior partner's status entries the same way the app layer does. The
    // changed_by_user_id predicate was ABSENT before migration 0037 (leads_scope's sibling policy).
    // (pg_policies.qual re-serializes with table qualifiers, e.g. COALESCE(leads.manual_partner_id, …).)
    expect(qual).toContain("changed_by_user_id"); // the R-22 author predicate is present
    expect(qual).toContain("manual_partner_id"); // still scoped by effective-owner lead ownership
    expect(qual).toContain("role = 'admin'"); // Option B: admin-authored entries stay visible to the owner
  });

  it("F-31: listPartnerActivity counts a partner's action on a manually-assigned (partnerId=null) lead", async () => {
    const [ml] = await db
      .insert(schema.leads)
      // backdated past the hold window so it's released to the partner (distribution hold)
      .values({ tenantId: id.tenantA, refId: "LD-26-00012", uploadId: id.uploadA, dedupeKey: "ma|00012", rawJson: {}, partnerId: null, matchMethod: "none", manualPartnerId: id.partnerX, mlsStatus: "kept", createdAt: new Date(Date.now() - 20 * 60 * 1000) })
      .returning({ id: schema.leads.id });
    await db.insert(schema.leadStatusHistory).values({ tenantId: id.tenantA, leadId: ml.id, status: "Contacted", changedByUserId: id.partnerUser });
    // Under the old eq(partnerId) predicate this lead (partnerId=null) was under-reported.
    const activity = await listPartnerActivity(partnerX());
    expect(activity.items.some((i) => i.detail.includes("LD-26-00012"))).toBe(true);
  });

  it("F-32: findProfileById never returns another tenant's saved source profile", async () => {
    const [prof] = await db
      .insert(schema.sourceProfiles)
      .values({ tenantId: id.tenantB, name: "B Profile", headerSignature: [], mapping: {}, requiredColumns: [] })
      .returning({ id: schema.sourceProfiles.id });
    // Tenant A must not see tenant B's profile even with a valid uuid…
    expect(await findProfileById(db, adminA(), prof.id)).toBeNull();
    // …but tenant B does.
    const adminB: ScopeContext = { tenantId: id.tenantB, role: "admin", userId: id.adminUser };
    expect(await findProfileById(db, adminB, prof.id)).not.toBeNull();
  });

  it("RLS is enabled on every application table (the database backstop)", async () => {
    const [{ count }] = await db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
    `) as unknown as { count: number }[];
    expect(Number(count)).toBeGreaterThanOrEqual(20);
  });

  it("SEC-01: the ensure_rls trigger auto-enables RLS on a newly created public table (ADR-0043)", async () => {
    // The count test above proves current state; this proves the BACKSTOP still works — that the
    // captured rls_auto_enable() event trigger actually fires and enables RLS on a table that did
    // NOT ask for it, which is the whole point (a future migration that forgets the explicit
    // `enable row level security` must not silently open a cross-tenant hole). A broken trigger is
    // invisible to a static count.
    try {
      await db.execute(sql`drop table if exists public._rls_probe`);
      await db.execute(sql`create table public._rls_probe (id uuid primary key)`);
      const [{ enabled }] = (await db.execute<{ enabled: boolean }>(sql`
        select c.relrowsecurity as enabled
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = '_rls_probe'
      `)) as unknown as { enabled: boolean }[];
      expect(enabled).toBe(true);
    } finally {
      await db.execute(sql`drop table if exists public._rls_probe`);
    }
  });

  it("SEC-01: the RLS claim helpers + audit trigger keep a pinned search_path (advisor 0011, migration 0040)", async () => {
    // These functions run inside every RLS policy; a search_path that follows the caller is the
    // classic hijack vector. 0040 pinned it — this guards against a future CREATE OR REPLACE both
    // dropping the pin entirely AND weakening it (e.g. to `search_path=public`, which would let a
    // public object shadow a built-in). Assert pg_catalog is FIRST, which is the actual property,
    // not merely that some search_path is set.
    const rows = (await db.execute<{ proname: string; pinned: boolean }>(sql`
      select p.proname,
             (p.proconfig is not null and exists (
               select 1 from unnest(p.proconfig) c where c like 'search_path=pg_catalog%'
             )) as pinned
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('app_current_claims','app_current_tenant','app_current_role',
                          'app_current_partner','app_current_user','reject_audit_log_mutation')
      order by p.proname
    `)) as unknown as { proname: string; pinned: boolean }[];
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.pinned)).toBe(true);
  });
});
