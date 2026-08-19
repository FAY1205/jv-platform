import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  leadIdentifierMatch,
  leadSearchMatch,
  partnerSearchMatch,
} from "@/modules/search/match";

// SRCH-06/07 — the shared search-match builder, inspected as SQL. These are the
// structural guarantees the three surfaces (Ctrl-K, admin leads list, portal list) all
// inherit from ONE definition: user text never reaches the SQL string, patterns are
// escaped, terms are ANDed, columns are ORed, and the phone leg appears only where the
// rule says it may.

const dialect = new PgDialect();
const render = (q: SQL | undefined) => {
  if (!q) throw new Error("expected a predicate");
  const { sql, params } = dialect.sqlToQuery(q);
  return { sql, params: params as string[] };
};

describe("SRCH-06: multi-term matching (AND of terms, OR of columns)", () => {
  it("SRCH-06: every term becomes its own OR-group over the searched columns", () => {
    const { sql, params } = render(leadSearchMatch("john phoenix"));
    // Two groups, ANDed. Six lead text columns per group, no phone leg (no digits).
    expect(params).toEqual([
      "%john%", "%john%", "%john%", "%john%", "%john%", "%john%",
      "%phoenix%", "%phoenix%", "%phoenix%", "%phoenix%", "%phoenix%", "%phoenix%",
    ]);
    expect(sql).toContain(" and ");
    expect(sql).toContain(" or ");
    expect(sql).toContain('"seller_first"');
    expect(sql).toContain('"ref_id"');
    expect(sql).not.toContain("phone_norm");
  });

  it("SRCH-06: a single-term query keeps v1 shape — one OR-group, six columns", () => {
    const { params } = render(leadSearchMatch("whitf"));
    expect(params).toEqual(["%whitf%", "%whitf%", "%whitf%", "%whitf%", "%whitf%", "%whitf%"]);
  });

  it("SRCH-06: a blank or whitespace-only query returns undefined (no filter is pushed)", () => {
    expect(leadSearchMatch("")).toBeUndefined();
    expect(leadSearchMatch("   ")).toBeUndefined();
    expect(partnerSearchMatch("")).toBeUndefined();
    expect(leadIdentifierMatch("")).toBeUndefined();
  });

  it("SRCH-06/DM-12: terms past the bound never reach the SQL", () => {
    const { params } = render(leadSearchMatch("a b c d e f g h"));
    expect(params).toHaveLength(6 * 6); // 6 terms × 6 columns — "g" and "h" are dropped
    expect(params).not.toContain("%g%");
  });

  it("SRCH-06: partners AND their terms too, over name/ref/email only", () => {
    const { sql, params } = render(partnerSearchMatch("cedar ridge"));
    expect(params).toEqual(["%cedar%", "%cedar%", "%cedar%", "%ridge%", "%ridge%", "%ridge%"]);
    expect(sql).toContain('"name"');
    expect(sql).toContain('"email"');
    expect(sql).not.toContain("phone_norm");
  });
});

describe("SRCH-07: escaping + phone digits", () => {
  it("SRCH-07: the query text is BOUND, never interpolated into the SQL string", () => {
    const { sql, params } = render(leadSearchMatch("Whitfield"));
    expect(sql).not.toContain("Whitfield");
    expect(sql).toContain("$1");
    expect(params[0]).toBe("%Whitfield%");
  });

  it("SRCH-07: LIKE metacharacters in a term are escaped into literals", () => {
    const { params } = render(leadSearchMatch("100% ranch"));
    expect(params[0]).toBe("%100\\%%");
    expect(params.at(-1)).toBe("%ranch%");
    // `_` too — otherwise "APT_5" would also match "APTX5".
    expect(render(leadSearchMatch("t_5")).params[0]).toBe("%t\\_5%");
    // …and the escape character itself.
    expect(render(leadSearchMatch("a\\")).params[0]).toBe("%a\\\\%");
  });

  it("SRCH-07: a query with ≥4 digits adds the phone_norm leg to its digit-bearing terms", () => {
    const { sql, params } = render(leadSearchMatch("602-555"));
    expect(sql).toContain('"phone_norm"');
    // digits of the WHOLE query, escaped like any other pattern
    expect(params).toContain("%602555%");
  });

  it("SRCH-07: the phone leg is NOT offered to a term with no digits (smith AND the number)", () => {
    const { params } = render(leadSearchMatch("smith 6025550"));
    // The "smith" group is six columns with no phone leg; the digit term gets seven.
    expect(params.slice(0, 6)).toEqual(Array.from({ length: 6 }, () => "%smith%"));
    expect(params.slice(0, 6)).not.toContain("%6025550%");
    expect(params.slice(6)).toEqual([
      ...Array.from({ length: 6 }, () => "%6025550%"),
      "%6025550%", // the phone_norm leg
    ]);
  });

  it("SRCH-07: a formatted number splits across terms and both halves get the WHOLE query's digits", () => {
    const { params } = render(leadSearchMatch("(602) 555-0148"));
    // Both terms carry digits, so both get the whole-query pattern.
    expect(params.filter((p) => p === "%6025550148%")).toHaveLength(2);
  });

  it(`SRCH-07: fewer than the digit floor adds no phone leg at all`, () => {
    const { sql } = render(leadSearchMatch("602"));
    expect(sql).not.toContain("phone_norm");
  });
});

describe("SRCH-08: the identifier rank input", () => {
  it("SRCH-08: identifier hits are ref id / ZIP / phone digits — ORed, never scope columns", () => {
    const { sql, params } = render(leadIdentifierMatch("85028"));
    expect(sql).toContain('"ref_id"');
    expect(sql).toContain('"zip"');
    expect(sql).toContain('"phone_norm"');
    expect(sql).not.toContain('"seller_first"');
    expect(sql).not.toContain('"address"');
    expect(params).toEqual(["%85028%", "%85028%", "%85028%"]);
    // PRN-08: nothing in the builder touches tenant/partner scope.
    expect(sql).not.toContain("tenant_id");
    expect(sql).not.toContain("partner_id");
  });

  it("SRCH-08: a text-only query still yields a predicate (it simply will not hit)", () => {
    const { sql } = render(leadIdentifierMatch("whitfield"));
    expect(sql).not.toContain("phone_norm");
    expect(sql).toContain('"ref_id"');
  });
});

describe("PRN-08: the builders are narrowing conjuncts only", () => {
  it("PRN-08: no builder emits a tenant, partner, role or deleted_at leg", () => {
    for (const built of [
      leadSearchMatch("john phoenix 85028"),
      partnerSearchMatch("cedar ridge"),
      leadIdentifierMatch("LD-26-70001"),
    ]) {
      const { sql } = render(built);
      for (const forbidden of ["tenant_id", "partner_id", "deleted_at", "role"]) {
        expect(sql).not.toContain(forbidden);
      }
    }
  });
});
