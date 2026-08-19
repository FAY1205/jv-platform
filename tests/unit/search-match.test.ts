import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  leadIdentifierMatch,
  leadRankExpr,
  leadSearchMatch,
  partnerRankExpr,
  partnerSearchMatch,
} from "@/modules/search/match";
import { SEARCH_MIN_CHARS, isSearchable, tokenize } from "@/modules/search/schema";

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

describe("SRCH-08: word_similarity argument order is pinned structurally", () => {
  // pr-reviewer F-1: the INTEGRATION ordering fixtures can only catch a swap when the two
  // arguments disagree, and most realistic pairs rank identically either way. This asserts
  // the rendered SQL directly, so an accidental swap fails here whatever the data looks like.
  //
  // word_similarity(a, b) scores a's trigram set against the closest continuous extent of
  // WORDS in b. The QUERY must be `a` and the COLUMN `b` — "find the query inside this
  // field". Swapped, it asks "find this whole field inside the query".
  const rendered = () => render(leadRankExpr("park lane", leadIdentifierMatch("park lane"))).sql;

  it("SRCH-08: every leads word_similarity call takes the bound query FIRST, the column SECOND", () => {
    const sql = rendered();
    const calls = sql.match(/word_similarity\([^)]*/g) ?? [];
    expect(calls).toHaveLength(3); // seller name, address, city

    for (const call of calls) {
      // First argument: the bound `$n::text` parameter — never a column reference.
      expect(call).toMatch(/^word_similarity\(\$\d+::text,/);
      expect(call).not.toMatch(/^word_similarity\(\s*coalesce/);
      expect(call).not.toMatch(/^word_similarity\("leads"/);
    }
    // Second argument: the columns, in the documented order.
    expect(sql).toMatch(/word_similarity\(\$\d+::text, coalesce\("leads"\."seller_first"/);
    expect(sql).toMatch(/word_similarity\(\$\d+::text, coalesce\("leads"\."address"/);
    expect(sql).toMatch(/word_similarity\(\$\d+::text, coalesce\("leads"\."city"/);
  });

  it("SRCH-08: the partners rank takes the bound query FIRST, partners.name SECOND", () => {
    const { sql, params } = render(partnerRankExpr("cedar ridge"));
    expect(sql).toMatch(/^word_similarity\(\$\d+::text, "partners"\."name"\)$/);
    expect(sql).not.toMatch(/word_similarity\("partners"/);
    expect(params).toEqual(["cedar ridge"]);
  });

  it("SRCH-08: the identifier tier is +2 — strictly above any similarity, which caps at 1.0", () => {
    const sql = rendered();
    expect(sql).toContain("then 2 else 0");
    // The bonus is added to the similarity, not multiplied or compared.
    expect(sql).toMatch(/end\)::real \+ greatest\(/);
  });

  it("SRCH-08: the rank binds the query as a parameter — the text never reaches the SQL string", () => {
    const { sql, params } = render(leadRankExpr("Whitfield", leadIdentifierMatch("Whitfield")));
    expect(sql).not.toContain("Whitfield");
    expect(params).toContain("Whitfield"); // the word_similarity argument, unescaped by design
    expect(params).toContain("%Whitfield%"); // the identifier ILIKE patterns, escaped
  });
});

describe("SRCH-06: isSearchable ⇒ tokenize is non-empty (the guard's invariant)", () => {
  // audit-tenancy F-1: globalSearch fails closed if a builder ever returns undefined, but
  // that guard should never fire — this pins the coupling it backstops. If a future change
  // to either function breaks the implication, this fails LOUDLY here instead of silently
  // leaning on the runtime guard.
  it("SRCH-06: any query isSearchable accepts produces at least one term", () => {
    const queries = [
      "wh", "  wh  ", "whitf", "john phoenix", "602-555", "(602) 555-0148",
      "%", "%%", "%_", "__", "\\\\", "a\\", "0%", "t_5", "...", "!!", "--",
      "​​", "ø ø", "  a  b  ", "x".repeat(120), "a b c d e f g h i j",
    ];
    for (const q of queries) {
      if (isSearchable(q)) {
        expect(tokenize(q).length, `tokenize(${JSON.stringify(q)}) must be non-empty`).toBeGreaterThan(0);
        expect(leadSearchMatch(q)).toBeDefined();
        expect(partnerSearchMatch(q)).toBeDefined();
      }
    }
  });

  it("SRCH-06: and the contrapositive — an empty tokenization is never searchable", () => {
    for (const q of ["", " ", "\t", "\n", "   ", "  "]) {
      expect(tokenize(q)).toEqual([]);
      expect(isSearchable(q)).toBe(false);
    }
    // The floor itself: exactly SEARCH_MIN_CHARS of real text is searchable and tokenizes.
    const atFloor = "a".repeat(SEARCH_MIN_CHARS);
    expect(isSearchable(atFloor)).toBe(true);
    expect(tokenize(atFloor)).toEqual([atFloor]);
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
