import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  leadWhere,
  noteWhere,
  taskWhere,
  leadChildWhere,
  statusHistoryWhere,
  ownStatusAuthorScope,
  isPartnerStream,
  streamOf,
  type ScopeContext,
} from "@/lib/scope";

// ─────────────────────────────────────────────────────────────────────────────
// Phase C / WP-ROLE-1 (risk-register #2): every admin-STREAM tier must produce
// byte-identical scope SQL. If a builder ever branches `role === "admin"` again, a
// member/viewer would fall down the PARTNER arm — these render the builders' SQL for
// all three staff tiers and pin member ≡ viewer ≡ admin, and partner ≠ admin.
// The postgres client below never connects: building SQL is pure; nothing executes.
// ─────────────────────────────────────────────────────────────────────────────

const client = postgres("postgres://never:connects@localhost:1/never", { max: 1 });
const db = drizzle(client, { schema });
const dialect = new PgDialect();

const T = "11111111-1111-1111-1111-111111111111";
const U = "22222222-2222-2222-2222-222222222222";
const P = "33333333-3333-3333-3333-333333333333";

const admin: ScopeContext = { tenantId: T, role: "admin", userId: U };
const member: ScopeContext = { tenantId: T, role: "member", userId: U };
const viewer: ScopeContext = { tenantId: T, role: "viewer", userId: U };
const partner: ScopeContext = { tenantId: T, role: "partner", userId: U, partnerId: P };

function render(x: SQL | undefined): { sql: string; params: unknown[] } {
  if (x === undefined) return { sql: "<undefined>", params: [] };
  const q = dialect.sqlToQuery(x);
  return { sql: q.sql, params: q.params };
}

const BUILDERS: [string, (s: ScopeContext) => SQL | undefined][] = [
  ["leadWhere", (s) => leadWhere(s)],
  ["noteWhere", (s) => noteWhere(s, db)],
  ["taskWhere", (s) => taskWhere(s, db)],
  ["leadChildWhere(status_history)", (s) => leadChildWhere(schema.leadStatusHistory, s, db)],
  ["leadChildWhere(listing_checks)", (s) => leadChildWhere(schema.listingChecks, s, db)],
  ["statusHistoryWhere", (s) => statusHistoryWhere(s, db)],
  ["ownStatusAuthorScope", (s) => ownStatusAuthorScope(s)],
];

describe("SCP-02: admin-stream tiers share one data shape", () => {
  for (const [name, build] of BUILDERS) {
    it(`SCP-02: ${name} — member and viewer SQL ≡ admin SQL`, () => {
      const a = render(build(admin));
      expect(render(build(member))).toEqual(a);
      expect(render(build(viewer))).toEqual(a);
    });

    it(`SCP-02: ${name} — partner SQL differs from admin (the wall exists)`, () => {
      expect(render(build(partner))).not.toEqual(render(build(admin)));
    });
  }
});

describe("SCP-03: the stream predicates", () => {
  it("SCP-03: isPartnerStream is true only for partner", () => {
    expect(isPartnerStream(admin)).toBe(false);
    expect(isPartnerStream(member)).toBe(false);
    expect(isPartnerStream(viewer)).toBe(false);
    expect(isPartnerStream(partner)).toBe(true);
  });

  it("SCP-03: streamOf maps every staff tier to the admin stream (PRN-13 stays binary)", () => {
    expect(streamOf(admin)).toBe("admin");
    expect(streamOf(member)).toBe("admin");
    expect(streamOf(viewer)).toBe("admin");
    expect(streamOf(partner)).toBe("partner");
  });
});
