import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

// WP-SEC-4 / SEC4-01..02 (ADR-0046 Decision-7): schema-wide least privilege. Migration 0046 stops
// Supabase's `public` default privileges from auto-granting write DML to anon/authenticated on
// future tables, and sweeps every existing public table. These are catalog-only assertions (no
// fixture): the durable, DERIVED guard that any scoped tenant table with a lingering DML grant —
// a future table that forgot the revoke, or one the sweep missed — fails loudly (pr-reviewer #79
// F-1). Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("SEC4: schema-wide least privilege (default privileges + swept tables)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;

  beforeAll(() => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client.end();
  });

  it("SEC4-01: default privileges grant NO write DML to anon/authenticated on future public tables", async () => {
    // pg_default_acl for the role migrations run as (postgres). After 0046 the auto-grant of
    // INSERT/UPDATE/DELETE/TRUNCATE to anon/authenticated on new public tables is gone.
    const rows = await db.execute<{ grantee: string; privilege_type: string }>(sql`
      select grantee::regrole::text as grantee, privilege_type
      from pg_default_acl d, aclexplode(d.defaclacl)
      where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r' and d.defaclrole = 'postgres'::regrole
        and grantee::regrole::text in ('anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    `);
    expect(rows, `default write privs still granted: ${JSON.stringify(rows)}`).toHaveLength(0);
  });

  it("SEC4-02: NO RLS-enabled public table grants write DML to anon/authenticated (derived)", async () => {
    // The derivation the per-table WP-SEC-3 test could not do — and derived from the RLS-ENABLED
    // fact (pg_class.relrowsecurity), not policy naming (audit-security F-3), so a scoped table
    // with a differently-named policy is still covered. Read from pg_class.relacl via aclexplode
    // (catalog-level, not filtered by current_user like information_schema, audit-security F-4).
    const rows = await db.execute<{ table_name: string; grantee: string; privilege_type: string }>(sql`
      select c.relname as table_name, a.grantee::regrole::text as grantee, a.privilege_type
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
      cross join lateral aclexplode(c.relacl) a
      where c.relkind = 'r' and c.relrowsecurity
        and a.grantee::regrole::text in ('anon', 'authenticated')
        and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      order by c.relname, grantee, a.privilege_type
    `);
    expect(rows, `RLS tables still writable by anon/authenticated: ${JSON.stringify(rows)}`).toHaveLength(0);
  });

  it("SEC4-02: the derivation is non-vacuous — there ARE RLS-enabled tables to check", async () => {
    // Guards SEC4-02 against a false pass if the catalog scan ever returns nothing.
    const [{ n }] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
      where c.relkind = 'r' and c.relrowsecurity
    `);
    expect(n).toBeGreaterThanOrEqual(5);
  });
});
