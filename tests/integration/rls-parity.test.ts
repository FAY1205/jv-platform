import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { noteWhere, taskWhere, statusHistoryWhere, type ScopeContext } from "@/lib/scope";
import { asRole, probeWrite, RLS_ORACLE_ENABLED, type RlsClaims } from "../helpers/rls";

// WP-SEC-2 / RLP-07..09 (ADR-0046): parity fixes proven by the WP-SEC-1 oracle. Legs
// marked "(RED before 0044)" fail against the pre-0044 policies (tenant-only WITH CHECK;
// lead_notes USING without the own-author + deleted_at predicates) and go green once
// migration 0044 + the lib/scope.ts role pin land. Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = RLS_ORACLE_ENABLED ? describe : describe.skip;

const SLUG = "test-rls-parity";

suite("RLP: RLS parity + author-role pin (enforced)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadNotes).where(inArray(schema.leadNotes.tenantId, tids));
    await db.delete(schema.leadTasks).where(inArray(schema.leadTasks.tenantId, tids));
    await db.delete(schema.listingChecks).where(inArray(schema.listingChecks.tenantId, tids));
    await db.delete(schema.leadStatusHistory).where(inArray(schema.leadStatusHistory.tenantId, tids));
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

    const [t] = await db.insert(schema.tenants).values({ name: "RLS Parity", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;

    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.py = py.id;

    id.adminUser = randomUUID();
    id.pxUser = randomUUID();
    id.pyUser = randomUUID();
    // The pathological row SCP-01 guards: an ADMIN user carrying a stray partner_id (PX).
    // users.partner_id has no role invariant (ADR-0044 F-10 says it is immutable, but nothing
    // stops this shape existing), so the own-org-author subquery must pin role='partner'.
    id.adminStray = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@rlp.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@rlp.test", role: "partner", partnerId: px.id });
    await db.insert(schema.users).values({ id: id.pyUser, tenantId: t.id, email: "py@rlp.test", role: "partner", partnerId: py.id });
    await db.insert(schema.users).values({ id: id.adminStray, tenantId: t.id, email: "stray@rlp.test", role: "admin", partnerId: px.id });

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-301", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    id.upload = up.id;
    // leadX: plainly owned by PX.
    const [leadX] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-30001", uploadId: up.id, dedupeKey: "x|1", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    // leadY: owned by PY.
    const [leadY] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-30002", uploadId: up.id, dedupeKey: "y|2", rawJson: {}, partnerId: py.id, matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    // leadZ: pipeline-owned by PX but RE-ROUTED to PY (manual overlay). Effective owner = PY.
    const [leadZ] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-30003", uploadId: up.id, dedupeKey: "z|3", rawJson: {}, partnerId: px.id, manualPartnerId: py.id, matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    id.leadX = leadX.id;
    id.leadY = leadY.id;
    id.leadZ = leadZ.id;

    // A partner note on leadZ authored by PX's org (before the re-route). PY now owns leadZ.
    await db.insert(schema.leadNotes).values({ tenantId: t.id, leadId: leadZ.id, authorUserId: id.pxUser, authorRole: "partner", body: "X-ORG note on re-routed Z" });
    // A partner-stream note authored by the ADMIN-STRAY user (pathological SCP-01 row) on leadX.
    await db.insert(schema.leadNotes).values({ tenantId: t.id, leadId: leadX.id, authorUserId: id.adminStray, authorRole: "partner", body: "STRAY-authored note on X" });
    // A genuine PX partner note on leadX (control: must stay visible to PX).
    await db.insert(schema.leadNotes).values({ tenantId: t.id, leadId: leadX.id, authorUserId: id.pxUser, authorRole: "partner", body: "PX genuine note on X" });
    // Same pathological shape for tasks (SCP-01 covers taskWhere too).
    await db.insert(schema.leadTasks).values({ tenantId: t.id, leadId: leadX.id, authorUserId: id.adminStray, authorRole: "partner", title: "STRAY-authored task on X" });
    await db.insert(schema.leadTasks).values({ tenantId: t.id, leadId: leadX.id, authorUserId: id.pxUser, authorRole: "partner", title: "PX genuine task on X" });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const pxScope = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pxUser, partnerId: id.px });
  const pyScope = (): ScopeContext => ({ tenantId: id.tenant, role: "partner", userId: id.pyUser, partnerId: id.py });
  const pxClaims = (): RlsClaims => ({ sub: id.pxUser, tenantId: id.tenant, role: "partner", partnerId: id.px });
  const pyClaims = (): RlsClaims => ({ sub: id.pyUser, tenantId: id.tenant, role: "partner", partnerId: id.py });
  const adminClaims = (): RlsClaims => ({ sub: id.adminUser, tenantId: id.tenant, role: "admin" });

  // ── RLP-07: lead_notes own-author READ leak at the DB layer (the R-22-for-notes hole) ──
  it("RLP-07: (RED before 0044) new owner cannot read the prior org's notes via RLS", async () => {
    // PY owns re-routed leadZ. The note there was authored by PX's org. The app-layer noteWhere
    // already hides it; the DB policy (0010) does NOT, until 0044 adds the own-author predicate.
    const bodies = await asRole(db, pyClaims(), async (tx) =>
      (await tx.select({ body: schema.leadNotes.body }).from(schema.leadNotes)).map((r) => r.body),
    );
    expect(bodies).not.toContain("X-ORG note on re-routed Z");
  });

  it("RLP-07: PX still reads its own notes via RLS (fix does not over-restrict)", async () => {
    const bodies = await asRole(db, pxClaims(), async (tx) =>
      (await tx.select({ body: schema.leadNotes.body }).from(schema.leadNotes)).map((r) => r.body),
    );
    expect(bodies).toContain("PX genuine note on X");
  });

  // ── RLP-08: WITH CHECK ≥ USING — cross-owner / cross-stream WRITES refused ──
  // Each probeWrite measures whether the write ACTUALLY persisted (owner-observed), so a weak
  // WITH CHECK that lets the row land is correctly reported denied=false (RED) — a RETURNING-based
  // check would misreport it denied because RETURNING re-applies the USING filter.
  const notesWith = (body: string) =>
    async (tx: typeof db) =>
      (await tx.select({ id: schema.leadNotes.id }).from(schema.leadNotes).where(eq(schema.leadNotes.body, body))).length;

  it("RLP-08: (RED before 0044) a partner cannot INSERT (fabricate) a lead owned by another partner", async () => {
    // The real leads_scope hole is INSERT: WITH CHECK is tenant-only, and INSERT has no old row
    // for USING to gate, so a partner can fabricate a lead assigned to anyone in-tenant. RLP-01's
    // WITH CHECK (partner arm: effective owner = me, live) closes it.
    const out = await probeWrite(db, pxClaims(),
      async (tx) => { await tx.insert(schema.leads).values({ tenantId: id.tenant, refId: "LD-26-3FAKE", uploadId: id.upload, dedupeKey: "fake|py", rawJson: {}, partnerId: id.py, matchMethod: "zip", mlsStatus: "kept" }); },
      async (tx) => (await tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.refId, "LD-26-3FAKE"))).length);
    expect(out.denied).toBe(true);
  });

  it("RLP-08: (regression) a partner still cannot re-route a lead they own — stays blocked after the WITH CHECK rewrite", async () => {
    // Blocked both before and after 0044 (verified live). Post-0044 the guarantee is RLP-01's
    // WITH CHECK partner arm: the re-pointed row's effective owner (coalesce(manual, partner))
    // is no longer me, so the write is rejected. Regression guard against the rewrite re-opening it.
    const out = await probeWrite(db, pxClaims(),
      async (tx) => { await tx.update(schema.leads).set({ manualPartnerId: id.py }).where(eq(schema.leads.id, id.leadX)); },
      async (tx) => (await tx.select({ id: schema.leads.id }).from(schema.leads).where(and(eq(schema.leads.id, id.leadX), eq(schema.leads.manualPartnerId, id.py)))).length);
    expect(out.denied).toBe(true);
  });

  it("RLP-08: (RED before 0044) a partner cannot INSERT a note into the admin stream", async () => {
    const out = await probeWrite(db, pxClaims(),
      async (tx) => { await tx.insert(schema.leadNotes).values({ tenantId: id.tenant, leadId: id.leadX, authorUserId: id.pxUser, authorRole: "admin", body: "sneak admin note" }); },
      notesWith("sneak admin note"));
    expect(out.denied).toBe(true);
  });

  it("RLP-08: (RED before 0044) a partner cannot write a note onto a lead they do not own", async () => {
    const out = await probeWrite(db, pxClaims(),
      async (tx) => { await tx.insert(schema.leadNotes).values({ tenantId: id.tenant, leadId: id.leadY, authorUserId: id.pxUser, authorRole: "partner", body: "note onto unowned Y" }); },
      notesWith("note onto unowned Y"));
    expect(out.denied).toBe(true);
  });

  it("RLP-08: (RED before 0044) a partner cannot write a status entry onto an unowned lead", async () => {
    const out = await probeWrite(db, pxClaims(),
      async (tx) => { await tx.insert(schema.leadStatusHistory).values({ tenantId: id.tenant, leadId: id.leadY, status: "contacted", changedByUserId: id.pxUser }); },
      async (tx) => (await tx.select({ id: schema.leadStatusHistory.id }).from(schema.leadStatusHistory).where(and(eq(schema.leadStatusHistory.leadId, id.leadY), eq(schema.leadStatusHistory.changedByUserId, id.pxUser)))).length);
    expect(out.denied).toBe(true);
  });

  it("RLP-08: (RED before 0044) a partner cannot write a listing check onto an unowned lead", async () => {
    const out = await probeWrite(db, pxClaims(),
      async (tx) => { await tx.insert(schema.listingChecks).values({ tenantId: id.tenant, leadId: id.leadY, provider: "mls-probe", status: "pending" }); },
      async (tx) => (await tx.select({ id: schema.listingChecks.id }).from(schema.listingChecks).where(and(eq(schema.listingChecks.leadId, id.leadY), eq(schema.listingChecks.provider, "mls-probe")))).length);
    expect(out.denied).toBe(true);
  });

  it("RLP-08: a partner's legitimate note on its own lead is still allowed (persists)", async () => {
    const out = await probeWrite(db, pxClaims(),
      async (tx) => { await tx.insert(schema.leadNotes).values({ tenantId: id.tenant, leadId: id.leadX, authorUserId: id.pxUser, authorRole: "partner", body: "legit own note" }); },
      notesWith("legit own note"));
    expect(out.denied).toBe(false);
    expect(out.effected).toBe(1);
  });

  // ── RLP-09 / SCP-01: the own-org-author subquery must pin role='partner' ──
  it("RLP-09/SCP-01: (RED before fix) an admin-stray-partner_id author is not counted into PX's notes", async () => {
    const bodies = (await db.select({ body: schema.leadNotes.body }).from(schema.leadNotes).where(noteWhere(pxScope(), db))).map((r) => r.body);
    expect(bodies).toContain("PX genuine note on X"); // genuine PX author stays
    expect(bodies).not.toContain("STRAY-authored note on X"); // admin-with-partner_id excluded
  });

  it("RLP-09/SCP-01: (RED before fix) an admin-stray-partner_id author is not counted into PX's tasks", async () => {
    const titles = (await db.select({ title: schema.leadTasks.title }).from(schema.leadTasks).where(taskWhere(pxScope(), db))).map((r) => r.title);
    expect(titles).toContain("PX genuine task on X");
    expect(titles).not.toContain("STRAY-authored task on X");
  });

  it("RLP-09/SCP-01: the RLS author subqueries carry role='partner' (0044 half)", async () => {
    for (const policy of ["lead_notes_scope", "lead_tasks_scope"]) {
      const rows = await db.execute<{ qual: string }>(sql`
        select qual from pg_policies where schemaname = 'public' and policyname = ${policy}
      `);
      expect(rows.length, `${policy} exists`).toBe(1);
      // Anchor on a word boundary (audit/pr-reviewer F-1): `author_role = 'partner'` (the
      // pre-existing STREAM predicate) contains "role = 'partner'" as a substring, so an
      // unanchored match would pass even if the RLP-06 pin were dropped. `\b` sits between the
      // non-word `.` in `users.role` and `r`, but NOT inside `author_role` (`_` is a word char),
      // so this matches only the standalone author-subquery pin.
      expect(rows[0].qual, `${policy} author subquery pins role='partner'`).toMatch(/\brole = 'partner'/);
    }
  });

  it("RLP-09/SCP-01: (RLS enforcement) an admin-stray author is excluded from PX's notes AND tasks via the authenticated surface", async () => {
    // The RLS-layer counterpart to the two app-layer SCP-01 tests above (pr-reviewer F-1): prove
    // Postgres — not just noteWhere/taskWhere — excludes the pathological admin-with-partner_id row.
    const noteBodies = await asRole(db, pxClaims(), async (tx) =>
      (await tx.select({ body: schema.leadNotes.body }).from(schema.leadNotes)).map((r) => r.body),
    );
    expect(noteBodies).toContain("PX genuine note on X");
    expect(noteBodies).not.toContain("STRAY-authored note on X");
    const taskTitles = await asRole(db, pxClaims(), async (tx) =>
      (await tx.select({ title: schema.leadTasks.title }).from(schema.leadTasks)).map((r) => r.title),
    );
    expect(taskTitles).toContain("PX genuine task on X");
    expect(taskTitles).not.toContain("STRAY-authored task on X");
  });

  it("RLP-07: (revert leg) reverting the re-route restores the prior org's note to PX and hides it from PY (ADR-0046 rule 5)", async () => {
    // The overlay-dependent-predicate revert leg: a naive "ownership follows the lead" regression
    // breaks exactly here. leadZ was pipeline-owned by PX, re-routed to PY. Revert → PX owns again.
    await db.update(schema.leads).set({ manualPartnerId: null }).where(eq(schema.leads.id, id.leadZ));
    try {
      const pxSees = await asRole(db, pxClaims(), async (tx) =>
        (await tx.select({ body: schema.leadNotes.body }).from(schema.leadNotes)).map((r) => r.body),
      );
      expect(pxSees).toContain("X-ORG note on re-routed Z"); // PX regains its own note
      const pySees = await asRole(db, pyClaims(), async (tx) =>
        (await tx.select({ body: schema.leadNotes.body }).from(schema.leadNotes)).map((r) => r.body),
      );
      expect(pySees).not.toContain("X-ORG note on re-routed Z"); // PY lost the lead → lost the note
    } finally {
      await db.update(schema.leads).set({ manualPartnerId: id.py }).where(eq(schema.leads.id, id.leadZ));
    }
  });

  it("RLP-08: (positive) a partner's legitimate status + listing writes on its own live lead succeed", async () => {
    const status = await probeWrite(db, pxClaims(),
      async (tx) => { await tx.insert(schema.leadStatusHistory).values({ tenantId: id.tenant, leadId: id.leadX, status: "RLP-ok-status", changedByUserId: id.pxUser }); },
      async (tx) => (await tx.select({ id: schema.leadStatusHistory.id }).from(schema.leadStatusHistory).where(and(eq(schema.leadStatusHistory.leadId, id.leadX), eq(schema.leadStatusHistory.status, "RLP-ok-status")))).length);
    expect(status.denied).toBe(false);
    expect(status.effected).toBe(1);
    const listing = await probeWrite(db, pxClaims(),
      async (tx) => { await tx.insert(schema.listingChecks).values({ tenantId: id.tenant, leadId: id.leadX, provider: "mls-ok", status: "pending" }); },
      async (tx) => (await tx.select({ id: schema.listingChecks.id }).from(schema.listingChecks).where(and(eq(schema.listingChecks.leadId, id.leadX), eq(schema.listingChecks.provider, "mls-ok")))).length);
    expect(listing.denied).toBe(false);
    expect(listing.effected).toBe(1);
  });

  it("RLP-01: (positive) admin retains full in-tenant write including recall/void of a lead", async () => {
    const out = await probeWrite(db, adminClaims(),
      async (tx) => { await tx.update(schema.leads).set({ deletedAt: sql`now()` }).where(eq(schema.leads.id, id.leadX)); },
      async (tx) => (await tx.select({ id: schema.leads.id }).from(schema.leads).where(and(eq(schema.leads.id, id.leadX), sql`${schema.leads.deletedAt} is not null`))).length);
    expect(out.denied).toBe(false);
    expect(out.effected).toBe(1);
  });

  it("RLP-03: (admin stream) an admin cannot write a partner-stream note", async () => {
    const out = await probeWrite(db, adminClaims(),
      async (tx) => { await tx.insert(schema.leadNotes).values({ tenantId: id.tenant, leadId: id.leadX, authorUserId: id.adminUser, authorRole: "partner", body: "admin sneaks partner note" }); },
      async (tx) => (await tx.select({ id: schema.leadNotes.id }).from(schema.leadNotes).where(eq(schema.leadNotes.body, "admin sneaks partner note"))).length);
    expect(out.denied).toBe(true);
  });

  it("RLP-04: (admin asymmetry, app layer) an admin's status entry stays visible to the current owning partner", async () => {
    // Deliberate: status is one shared field, so ownStatusAuthorScope keeps role='admin' visible.
    // This is an APP-LAYER (owner connection) property, asserted via statusHistoryWhere — NOT via
    // the RLS surface: the RLS author subquery `changed_by_user_id in (select id from users …)`
    // is itself filtered by users-RLS when run as an authenticated partner, and a partner cannot
    // see admin USERS, so the role='admin' arm never fires there. The RLS backstop is therefore
    // intentionally MORE restrictive (deny-more, no leak) than the app; the correct product
    // behaviour lives on the owner connection. Tracked as a candidate (RLS/app author asymmetry).
    await db.insert(schema.leadStatusHistory).values({ tenantId: id.tenant, leadId: id.leadY, status: "ADMIN-STATUS-ON-Y", changedByUserId: id.adminUser });
    const pySees = (
      await db.select({ status: schema.leadStatusHistory.status }).from(schema.leadStatusHistory).where(statusHistoryWhere(pyScope(), db))
    ).map((r) => r.status);
    expect(pySees).toContain("ADMIN-STATUS-ON-Y"); // PY owns leadY; admin author visible via the app layer
  });

  it("RLP-04: (R-22 for status) a new owner cannot read the prior org's status entries via RLS", async () => {
    // A status entry authored by PX's org on the re-routed leadZ (now owned by PY): PY must not see
    // it (author scope), and PX no longer owns leadZ so PX doesn't either. Re-proves the R-22
    // boundary at the enforcement layer after the 0044 subquery rewrite (audit-tenancy F-5).
    await db.insert(schema.leadStatusHistory).values({ tenantId: id.tenant, leadId: id.leadZ, status: "PX-STATUS-ON-Z", changedByUserId: id.pxUser });
    const pySees = await asRole(db, pyClaims(), async (tx) =>
      (await tx.select({ status: schema.leadStatusHistory.status }).from(schema.leadStatusHistory)).map((r) => r.status),
    );
    expect(pySees).not.toContain("PX-STATUS-ON-Z");
  });
});
