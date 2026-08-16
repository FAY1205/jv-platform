import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { pgErrorCode } from "@/lib/db/pg-error";
import { asRole, POLICY_VIOLATION, LEAD_FAMILY_TABLES, IS_SUPABASE_DB, type RlsClaims } from "../helpers/rls";

// WP-SEC-3 / SEC3-01..04 (ADR-0046 Decision-6): least privilege on the authenticated/PostgREST
// surface. Migration 0045 REVOKEs INSERT/UPDATE/DELETE from anon/authenticated on the five
// lead-family tables — the DELETE + column-tamper hole WITH CHECK cannot express. These tests
// prove the write surface is dead (a partner cannot DELETE/UPDATE/INSERT even on an
// RLS-VISIBLE own row) while SELECT still works, so RLS is now pure defense-in-depth. `asRole`
// grants nothing, so it exercises the REAL revoked surface (unlike probeWrite, which grants DML
// in-txn to keep the WITH CHECK layer testable). Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = IS_SUPABASE_DB ? describe : describe.skip;

const SLUG = "test-rls-grants";
// SQL array literal of the revoked tables, built from the shared source of truth (helpers/rls.ts).
const TABLE_ARRAY = sql.raw(`array[${LEAD_FAMILY_TABLES.map((t) => `'${t}'`).join(",")}]`);

suite("SEC3: least-privilege grant revoke on the authenticated surface", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const id: Record<string, string> = {};

  async function cleanup() {
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.slug, [SLUG]));
    const tids = tenants.map((t) => t.id);
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
    const [t] = await db.insert(schema.tenants).values({ name: "RLS Grants", slug: SLUG }).returning({ id: schema.tenants.id });
    id.tenant = t.id;
    const [px] = await db.insert(schema.partners).values({ tenantId: t.id, refId: "JV-001", name: "PX", color: "#111", status: "active" }).returning({ id: schema.partners.id });
    id.px = px.id;
    id.pxUser = randomUUID();
    await db.insert(schema.users).values({ id: id.pxUser, tenantId: t.id, email: "px@grants.test", role: "partner", partnerId: px.id });
    const [up] = await db.insert(schema.uploads).values({ tenantId: t.id, refId: "IM-26-401", filename: "a.xlsx", status: "processed" }).returning({ id: schema.uploads.id });
    const [leadX] = await db
      .insert(schema.leads)
      .values({ tenantId: t.id, refId: "LD-26-40001", uploadId: up.id, dedupeKey: "x|1", rawJson: {}, partnerId: px.id, matchMethod: "zip", mlsStatus: "kept" })
      .returning({ id: schema.leads.id });
    id.leadX = leadX.id;
    const [note] = await db
      .insert(schema.leadNotes)
      .values({ tenantId: t.id, leadId: leadX.id, authorUserId: id.pxUser, authorRole: "partner", body: "PX own note" })
      .returning({ id: schema.leadNotes.id });
    id.noteX = note.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  const pxClaims = (): RlsClaims => ({ sub: id.pxUser, tenantId: id.tenant, role: "partner", partnerId: id.px });

  it("SEC3-01: anon/authenticated hold NO insert/update/delete on the lead-family tables", async () => {
    const rows = await db.execute<{ table_name: string; grantee: string; privilege_type: string }>(sql`
      select table_name, grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and table_name = any(${TABLE_ARRAY})
        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
      order by table_name, grantee, privilege_type
    `);
    expect(rows, `write DML still granted: ${JSON.stringify(rows)}`).toHaveLength(0);
  });

  it("SEC3-02: a partner cannot DELETE its OWN (RLS-visible) note — grant, not RLS, denies it", async () => {
    // asRole grants nothing, so this hits the revoked grant. The row IS RLS-visible (SEC3-04),
    // which isolates the grant as the gate: RLS USING would admit the delete; the missing grant
    // rejects it with 42501 before RLS is consulted. This is the DELETE hole WITH CHECK cannot close.
    const code = await asRole(db, pxClaims(), async (tx) => {
      try {
        await tx.delete(schema.leadNotes).where(eq(schema.leadNotes.id, id.noteX));
        return "allowed";
      } catch (e) {
        return pgErrorCode(e) ?? "other-error";
      }
    });
    expect(code).toBe(POLICY_VIOLATION);
    // And the row is still there (owner-observed) — the delete never happened.
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from lead_notes where id = ${id.noteX}`);
    expect(n).toBe(1);
  });

  it("SEC3-03: a partner cannot INSERT or UPDATE on the authenticated surface (write is dead)", async () => {
    const insertCode = await asRole(db, pxClaims(), async (tx) => {
      try {
        await tx.insert(schema.leadNotes).values({ tenantId: id.tenant, leadId: id.leadX, authorUserId: id.pxUser, authorRole: "partner", body: "should not land" });
        return "allowed";
      } catch (e) {
        return pgErrorCode(e) ?? "other-error";
      }
    });
    expect(insertCode).toBe(POLICY_VIOLATION);
    const updateCode = await asRole(db, pxClaims(), async (tx) => {
      try {
        await tx.update(schema.leadNotes).set({ body: "tampered" }).where(eq(schema.leadNotes.id, id.noteX));
        return "allowed";
      } catch (e) {
        return pgErrorCode(e) ?? "other-error";
      }
    });
    expect(updateCode).toBe(POLICY_VIOLATION);
  });

  it("SEC3-04: SELECT is retained — a partner still reads its own note via RLS", async () => {
    const bodies = await asRole(db, pxClaims(), async (tx) =>
      (await tx.select({ body: schema.leadNotes.body }).from(schema.leadNotes)).map((r) => r.body),
    );
    expect(bodies).toContain("PX own note");
  });

  it("SEC3-05: the revoke covers all five lead-family tables (no table left writable)", async () => {
    // Guards the migration's table list: derive writable tables and assert none of the five remain.
    const rows = await db.execute<{ table_name: string }>(sql`
      select distinct table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon','authenticated')
        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
        and table_name = any(${TABLE_ARRAY})
    `);
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});
