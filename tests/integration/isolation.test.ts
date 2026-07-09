import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { tenantWhere, leadWhere, noteWhere, type ScopeContext } from "@/lib/scope";

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
    await db.delete(schema.leads).where(inArray(schema.leads.tenantId, tids));
    await db.delete(schema.uploads).where(inArray(schema.uploads.tenantId, tids));
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

    const [ua] = await db.insert(schema.uploads).values({ tenantId: ta.id, refId: "UP-2026-001", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [ub] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "UP-2026-001", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });

    const [lx] = await db.insert(schema.leads).values({ tenantId: ta.id, refId: "LD-2026-00001", uploadId: ua.id, dedupeKey: "x|00001", rawJson: {}, partnerId: px.id, matchMethod: "zip" }).returning({ id: schema.leads.id });
    const [ly] = await db.insert(schema.leads).values({ tenantId: ta.id, refId: "LD-2026-00002", uploadId: ua.id, dedupeKey: "y|00002", rawJson: {}, partnerId: py.id, matchMethod: "zip" }).returning({ id: schema.leads.id });
    const [lz] = await db.insert(schema.leads).values({ tenantId: tb.id, refId: "LD-2026-00001", uploadId: ub.id, dedupeKey: "z|00003", rawJson: {}, partnerId: pz.id, matchMethod: "zip" }).returning({ id: schema.leads.id });
    // An unmatched lead in tenant A, manually assigned to partner Y (ASN-03).
    const [lm] = await db
      .insert(schema.leads)
      .values({ tenantId: ta.id, refId: "LD-2026-00009", uploadId: ua.id, dedupeKey: "m|00009", rawJson: {}, partnerId: null, matchMethod: "none", manualPartnerId: py.id, manualAssignedAt: new Date(), manualAssignedBy: id.adminUser })
      .returning({ id: schema.leads.id });
    // A MATCHED lead (pipeline partner X) later re-routed to Y via the manual overlay.
    // Effective owner is Y; X must LOSE access (audit F-01 divergence case).
    const [lr] = await db
      .insert(schema.leads)
      .values({ tenantId: ta.id, refId: "LD-2026-00010", uploadId: ua.id, dedupeKey: "r|00010", rawJson: {}, partnerId: px.id, matchMethod: "zip", manualPartnerId: py.id, manualAssignedAt: new Date(), manualAssignedBy: id.adminUser })
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

  it("RLS is enabled on every application table (the database backstop)", async () => {
    const [{ count }] = await db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
    `) as unknown as { count: number }[];
    expect(Number(count)).toBeGreaterThanOrEqual(20);
  });
});
