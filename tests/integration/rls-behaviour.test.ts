import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { asRole, probeWrite, RLS_ORACLE_ENABLED, type RlsClaims } from "../helpers/rls";

// WP-SEC-1 / RLSB-01..05 (ADR-0046): the RLS ENFORCEMENT oracle. Unlike the *-scope
// suites (which read pg_policies text), this runs reads/writes as the non-owner
// `authenticated` role under bound JWT claims and asserts Postgres actually enforces
// the policy. It is exercised here against lead_tasks_scope (migration 0041) — the
// policy already at the two-half standard — so every denial the oracle reports is a
// true positive and every allow a true negative: the harness is validated against a
// known-good policy before WP-SEC-2 leans on it to prove the fixed policies.
// Self-skips without DATABASE_URL; run with node --env-file=.env.local.
const url = process.env.DATABASE_URL;
const suite = RLS_ORACLE_ENABLED ? describe : describe.skip;

const SLUG = "test-rls-beh";
const SLUG_B = "test-rls-beh-b";

// C-8 / WP-TSK-2a: a lead is partner-visible only once past the distribution hold (5 min). Seed
// the leads a partner must SEE with a released created_at; a lead left at the default now() is HELD.
const RELEASED_AT = new Date(Date.now() - 10 * 60 * 1000);

suite("RLSB: RLS enforcement oracle (non-owner role)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG, SLUG_B]));
    const tids = tenants.map((t) => t.id);
    if (tids.length === 0) return;
    await db.delete(schema.leadTasks).where(inArray(schema.leadTasks.tenantId, tids));
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

    const [t] = await db.insert(schema.tenants).values({ name: "RLS Beh", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [tb] = await db.insert(schema.tenants).values({ name: "RLS Beh B", slug: SLUG_B }).returning({ id: schema.tenants.id });
    id.tenantB = tb.id;

    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111", status: "active" }).returning({ id: schema.partners.id });
    const [py] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-002", name: "PY", color: "#222", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.py = py.id;

    id.adminUser = randomUUID();
    id.pxUser = randomUUID();
    id.pyUser = randomUUID();
    id.memberUser = randomUUID();
    id.viewerUser = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUser, tenantId: t.id, email: "admin@rlsbeh.test", role: "admin" });
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@rlsbeh.test", role: "partner", partnerId: px.id });
    await db.insert(schema.users).values({ id: id.pyUser, tenantId: t.id, email: "py@rlsbeh.test", role: "partner", partnerId: py.id });
    // Phase C: the admin-STREAM tiers (0053 enum values; partner_id NULL per the SCP-08 CHECK).
    await db.insert(schema.users).values({ id: id.memberUser, tenantId: t.id, email: "member@rlsbeh.test", role: "member" });
    await db.insert(schema.users).values({ id: id.viewerUser, tenantId: t.id, email: "viewer@rlsbeh.test", role: "viewer" });

    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-201", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [leadX] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-20001", uploadId: up.id, dedupeKey: "x|1", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept", createdAt: RELEASED_AT })
      .returning({ id: schema.leads.id });
    const [leadY] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-20002", uploadId: up.id, dedupeKey: "y|2", rawJson: {}, partnerId: py.id, matchMethod: "zip", mlsStatus: "kept", createdAt: RELEASED_AT })
      .returning({ id: schema.leads.id });
    id.leadX = leadX.id;
    id.leadY = leadY.id;

    // Tenant B: admin + one lead, for the cross-tenant probe.
    id.adminUserB = randomUUID();
    await db.insert(schema.users).values({ id: id.adminUserB, tenantId: tb.id, email: "admin@rlsbeh-b.test", role: "admin" });
    const [upB] = await db.insert(schema.uploads).values({ tenantId: tb.id, refId: "IM-26-202", filename: "b.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [leadB] = await db
      .insert(schema.leads)
      .values({ tenantId: tb.id, refId: "LD-26-20003", uploadId: upB.id, dedupeKey: "z|3", rawJson: {}, matchMethod: "none", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    id.leadB = leadB.id;

    // Seed the three task streams (as owner — RLS bypassed on this connection).
    await db.insert(schema.leadTasks).values({ tenantId: t.id, leadId: leadX.id, authorUserId: id.adminUser, authorRole: "admin", title: "ADMIN task on X" });
    await db.insert(schema.leadTasks).values({ tenantId: t.id, leadId: leadX.id, authorUserId: id.pxUser, authorRole: "partner", title: "X-PARTNER task on X" });
    await db.insert(schema.leadTasks).values({ tenantId: t.id, leadId: leadY.id, authorUserId: id.pyUser, authorRole: "partner", title: "Y-PARTNER task on Y" });

    // C-8 / WP-TSK-2a: a STILL-HELD lead owned by PX (default created_at = now), with a PX task on
    // it — for the hold-enforcement case below. PX owns it, but cannot see it yet.
    const [leadHeld] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-20004", uploadId: up.id, dedupeKey: "h|4", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    id.leadHeld = leadHeld.id;
    await db.insert(schema.leadTasks).values({ tenantId: t.id, leadId: leadHeld.id, authorUserId: id.pxUser, authorRole: "partner", title: "X-PARTNER task on HELD" });
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const adminClaims = (): RlsClaims => ({ sub: id.adminUser, tenantId: id.tenant, role: "admin" });
  const pxClaims = (): RlsClaims => ({ sub: id.pxUser, tenantId: id.tenant, role: "partner", partnerId: id.px });
  const pyClaims = (): RlsClaims => ({ sub: id.pyUser, tenantId: id.tenant, role: "partner", partnerId: id.py });
  const memberClaims = (): RlsClaims => ({ sub: id.memberUser, tenantId: id.tenant, role: "member" });
  const viewerClaims = (): RlsClaims => ({ sub: id.viewerUser, tenantId: id.tenant, role: "viewer" });

  const taskTitlesAs = (claims: RlsClaims) =>
    asRole(db, claims, async (tx) =>
      (await tx.select({ title: schema.leadTasks.title }).from(schema.leadTasks)).map((r) => r.title),
    );

  it("RLSB-02: JWT claims bind inside the transaction (else every policy silently denies)", async () => {
    const asAdmin = await asRole(db, adminClaims(), async (tx) =>
      (await tx.execute<{ cu: string; t: string; r: string; u: string }>(sql`
        select current_user as cu, app_current_tenant() as t, app_current_role() as r, app_current_user() as u
      `))[0],
    );
    expect(asAdmin.cu).toBe("authenticated");
    expect(asAdmin.t).toBe(id.tenant);
    expect(asAdmin.r).toBe("admin");
    expect(asAdmin.u).toBe(id.adminUser);

    const asPx = await asRole(db, pxClaims(), async (tx) =>
      (await tx.execute<{ p: string }>(sql`select app_current_partner() as p`))[0],
    );
    expect(asPx.p).toBe(id.px);
  });

  it("RLSB-03: tenant isolation is ENFORCED, not just declared (read + write)", async () => {
    // Read: a partner in tenant A sees zero tenant-B leads through RLS.
    const bLeadsSeenByA = await asRole(db, pxClaims(), async (tx) =>
      (await tx.execute<{ n: number }>(sql`select count(*)::int as n from leads where tenant_id = ${id.tenantB}`))[0].n,
    );
    expect(bLeadsSeenByA).toBe(0);

    // Write: inserting a task stamped with another tenant's id is refused by WITH CHECK.
    const crossTenant = await probeWrite(
      db,
      pxClaims(),
      async (tx) => {
        await tx
          .insert(schema.leadTasks)
          .values({ tenantId: id.tenantB, leadId: id.leadB, authorUserId: id.pxUser, authorRole: "partner", title: "cross-tenant" });
      },
      async (tx) =>
        (await tx.select({ id: schema.leadTasks.id }).from(schema.leadTasks).where(eq(schema.leadTasks.title, "cross-tenant"))).length,
    );
    expect(crossTenant.denied).toBe(true);
  });

  it("RLSB-04: stream + ownership reads are ENFORCED on lead_tasks", async () => {
    const admin = await taskTitlesAs(adminClaims());
    expect(admin).toContain("ADMIN task on X");
    expect(admin).not.toContain("X-PARTNER task on X"); // admin never sees the partner stream
    expect(admin).not.toContain("Y-PARTNER task on Y");

    const x = await taskTitlesAs(pxClaims());
    expect(x).toContain("X-PARTNER task on X");
    expect(x).not.toContain("ADMIN task on X"); // partner never sees the admin stream
    expect(x).not.toContain("Y-PARTNER task on Y"); // …nor another partner's tasks

    const y = await taskTitlesAs(pyClaims());
    expect(y).toContain("Y-PARTNER task on Y");
    expect(y).not.toContain("X-PARTNER task on X");
  });

  it("RLSB-06 (C-8): the distribution hold is ENFORCED — a partner cannot read or write a task on a still-held lead", async () => {
    // PX owns leadHeld, but it is within the hold window, so the policy's partner ownLeads arm
    // (created_at < now() - 5min, migration 0047) excludes it: the task is invisible via RLS.
    const x = await taskTitlesAs(pxClaims());
    expect(x).not.toContain("X-PARTNER task on HELD");

    // …and PX cannot INSERT a task onto the held lead either — the WITH CHECK ownLeads arm carries
    // the same hold, so the write is refused (WITH CHECK ≥ USING, ADR-0046).
    const write = await probeWrite(
      db,
      pxClaims(),
      async (tx) => {
        await tx
          .insert(schema.leadTasks)
          .values({ tenantId: id.tenant, leadId: id.leadHeld, authorUserId: id.pxUser, authorRole: "partner", title: "premature" });
      },
      async (tx) =>
        (await tx.select({ id: schema.leadTasks.id }).from(schema.leadTasks).where(eq(schema.leadTasks.title, "premature"))).length,
    );
    expect(write.denied).toBe(true);
  });

  it("RLSB-07 (Phase C): member/viewer claims take the STAFF arm — tenant reads allowed, cross-tenant + partner stream denied", async () => {
    // Staff arm (`app_current_role() <> 'partner'`, migration 0054): a member sees every
    // in-tenant lead — including a still-HELD one (the hold is partner-only) — exactly like
    // an admin claim. Read-only-ness of the viewer TIER is an app-layer property (lib/authz);
    // the backstop's job is stream + tenant isolation only (ADR-0049 §11.5).
    for (const claims of [memberClaims(), viewerClaims()]) {
      const leads = await asRole(db, claims, async (tx) =>
        (await tx.execute<{ n: number }>(sql`select count(*)::int as n from leads where tenant_id = ${id.tenant}`))[0].n,
      );
      expect(leads, claims.role).toBe(3); // leadX + leadY + leadHeld

      const crossTenant = await asRole(db, claims, async (tx) =>
        (await tx.execute<{ n: number }>(sql`select count(*)::int as n from leads where tenant_id = ${id.tenantB}`))[0].n,
      );
      expect(crossTenant, claims.role).toBe(0);

      // PRN-13: the staff arm reads ONLY the admin stream — no partner-authored task leaks.
      const titles = await taskTitlesAs(claims);
      expect(titles, claims.role).toContain("ADMIN task on X");
      expect(titles.filter((t) => t.includes("PARTNER")), claims.role).toEqual([]);
    }

    // A member's admin-stream WRITE persists (tier write-limits are app-layer; the stream
    // boundary is the DB's job)…
    const staffWrite = await probeWrite(
      db,
      memberClaims(),
      async (tx) => {
        await tx
          .insert(schema.leadTasks)
          .values({ tenantId: id.tenant, leadId: id.leadX, authorUserId: id.memberUser, authorRole: "admin", title: "member-staff-write" });
      },
      async (tx) =>
        (await tx.select({ id: schema.leadTasks.id }).from(schema.leadTasks).where(eq(schema.leadTasks.title, "member-staff-write"))).length,
    );
    expect(staffWrite.denied).toBe(false);

    // …but a member forging a PARTNER-stream row is refused (the wall holds both ways).
    const crossStream = await probeWrite(
      db,
      memberClaims(),
      async (tx) => {
        await tx
          .insert(schema.leadTasks)
          .values({ tenantId: id.tenant, leadId: id.leadX, authorUserId: id.memberUser, authorRole: "partner", title: "member-forged-partner" });
      },
      async (tx) =>
        (await tx.select({ id: schema.leadTasks.id }).from(schema.leadTasks).where(eq(schema.leadTasks.title, "member-forged-partner"))).length,
    );
    expect(crossStream.denied).toBe(true);
  });

  it("RLSB-04: cross-stream / cross-owner WRITES are refused; the legitimate write is allowed", async () => {
    const insertTask = (v: { leadId: string; authorUserId: string; authorRole: "admin" | "partner"; title: string }) =>
      async (tx: typeof db) => {
        await tx.insert(schema.leadTasks).values({ tenantId: id.tenant, ...v });
      };
    const landed = (title: string) =>
      async (tx: typeof db) =>
        (await tx.select({ id: schema.leadTasks.id }).from(schema.leadTasks).where(eq(schema.leadTasks.title, title))).length;

    // Partner writing into the ADMIN stream — WITH CHECK admin arm needs role='admin'.
    const intoAdminStream = await probeWrite(db, pxClaims(),
      insertTask({ leadId: id.leadX, authorUserId: id.pxUser, authorRole: "admin", title: "sneak admin" }), landed("sneak admin"));
    expect(intoAdminStream.denied).toBe(true);

    // Partner writing a task onto a lead they do NOT own (leadY belongs to PY).
    const ontoUnowned = await probeWrite(db, pxClaims(),
      insertTask({ leadId: id.leadY, authorUserId: id.pxUser, authorRole: "partner", title: "onto unowned" }), landed("onto unowned"));
    expect(ontoUnowned.denied).toBe(true);

    // Partner writing another user as the author (author_user_id must equal app_current_user).
    const spoofAuthor = await probeWrite(db, pxClaims(),
      insertTask({ leadId: id.leadX, authorUserId: id.pyUser, authorRole: "partner", title: "spoofed author" }), landed("spoofed author"));
    expect(spoofAuthor.denied).toBe(true);

    // The legitimate write: own stream, own lead, self as author — allowed, persists, then rolled back.
    const legit = await probeWrite(db, pxClaims(),
      insertTask({ leadId: id.leadX, authorUserId: id.pxUser, authorRole: "partner", title: "legit own task" }), landed("legit own task"));
    expect(legit.denied).toBe(false);
    expect(legit.effected).toBe(1);
  });

  it("RLSB-05: every table carrying a *_scope policy has RLS ENABLED (derived, not hardcoded)", async () => {
    // The ADR-0043 auto-enable trigger is the mechanism; this fails loudly if a FUTURE table
    // ships a *_scope policy but forgets ENABLE ROW LEVEL SECURITY. The table set is derived
    // from pg_policies (audit-security F-4) so a new scoped table is covered automatically.
    const rows = await db.execute<{ tablename: string; relrowsecurity: boolean }>(sql`
      select distinct c.relname as tablename, c.relrowsecurity
      from pg_policies p
      join pg_class c on c.relname = p.tablename
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where p.schemaname = 'public' and p.policyname ~ '_scope$'
      order by c.relname
    `);
    expect(rows.length, "at least the five lead-family scoped tables exist").toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.tablename} (carries a *_scope policy) has RLS enabled`).toBe(true);
    }
    // Sanity: the five lead-family tables are among the derived set (guards the derivation itself).
    const names = rows.map((r) => r.tablename);
    for (const t of ["leads", "lead_notes", "lead_tasks", "lead_status_history", "listing_checks"]) {
      expect(names, `${t} carries a *_scope policy`).toContain(t);
    }
  });
});
