import { describe, it, expect } from "vitest";
import {
  SEARCH_MIN_CHARS,
  SEARCH_PHONE_MIN_DIGITS,
  SearchQuerySchema,
  containsPattern,
  escapeLike,
  isSearchable,
  searchPhoneDigits,
} from "@/modules/search/schema";
import { highlightParts, isGlobalSearchHotkey } from "@/lib/global-search";

// SRCH-01/02/03 — the pure half of global search: the query contract, the ILIKE
// escaping that keeps a user's `%` from meaning "everything", the phone-digit rule,
// the hotkey rule, and the escape-safe highlight splitter.

describe("SRCH-01: search query contract", () => {
  it("SRCH-01: trims, caps at 120 chars, and degrades junk to an empty query (never a 400)", () => {
    expect(SearchQuerySchema.parse({ q: "  whitf  " }).q).toBe("whitf");
    expect(SearchQuerySchema.parse({}).q).toBe("");
    expect(SearchQuerySchema.parse({ q: 42 }).q).toBe("");
    expect(SearchQuerySchema.parse({ q: ["a", "b"] }).q).toBe("");
    expect(SearchQuerySchema.parse({ q: "x".repeat(400) }).q).toHaveLength(120);
  });

  it(`SRCH-01: a query shorter than ${SEARCH_MIN_CHARS} chars is not searchable`, () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("w")).toBe(false);
    expect(isSearchable(" w ")).toBe(false);
    expect(isSearchable("wh")).toBe(true);
  });
});

describe("SRCH-01: ILIKE metacharacter escaping", () => {
  it("SRCH-01: %, _ and the backslash escape are neutralised into literals", () => {
    expect(escapeLike("%")).toBe("\\%");
    expect(escapeLike("_")).toBe("\\_");
    expect(escapeLike("\\")).toBe("\\\\");
    expect(escapeLike("100%_off")).toBe("100\\%\\_off");
  });

  it("SRCH-01: a bare % becomes a literal-percent pattern, not match-everything", () => {
    // The dangerous outcome would be "%%%" (every row in the tenant).
    expect(containsPattern("%")).toBe("%\\%%");
    expect(containsPattern("whitf")).toBe("%whitf%");
  });

  it("SRCH-01: ordinary text is untouched", () => {
    expect(escapeLike("4127 E Cactus Wren Dr")).toBe("4127 E Cactus Wren Dr");
  });
});

describe("SRCH-01: phone digit normalization", () => {
  it("SRCH-01: a formatted phone reduces to its digits for the phone_norm match", () => {
    expect(searchPhoneDigits("(602) 555-0148")).toBe("6025550148");
    expect(searchPhoneDigits("602-555")).toBe("602555");
  });

  it(`SRCH-01: fewer than ${SEARCH_PHONE_MIN_DIGITS} digits does not search phones at all`, () => {
    expect(searchPhoneDigits("whitf")).toBeNull();
    expect(searchPhoneDigits("12")).toBeNull();
    expect(searchPhoneDigits("123")).toBeNull();
    expect(searchPhoneDigits("1234")).toBe("1234");
  });

  it("SRCH-01: a ref-id query still yields its digits (both predicates can match)", () => {
    expect(searchPhoneDigits("LD-25-01847")).toBe("2501847");
  });
});

describe("SRCH-02: hotkey rule", () => {
  const ev = (over: Partial<KeyboardEvent>) =>
    ({ key: "k", ctrlKey: false, metaKey: false, altKey: false, ...over }) as KeyboardEvent;

  it("SRCH-02: Ctrl-K and ⌘-K open search; a bare k or Alt-chord does not", () => {
    expect(isGlobalSearchHotkey(ev({ ctrlKey: true }))).toBe(true);
    expect(isGlobalSearchHotkey(ev({ metaKey: true }))).toBe(true);
    expect(isGlobalSearchHotkey(ev({ ctrlKey: true, key: "K" }))).toBe(true);
    expect(isGlobalSearchHotkey(ev({}))).toBe(false);
    expect(isGlobalSearchHotkey(ev({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isGlobalSearchHotkey(ev({ ctrlKey: true, key: "j" }))).toBe(false);
  });
});

describe("SRCH-02: highlight splitting", () => {
  it("SRCH-02: splits case-insensitively into matched and unmatched runs", () => {
    expect(highlightParts("Whitfield, Marcus", "whitf")).toEqual([
      { text: "Whitf", match: true },
      { text: "ield, Marcus", match: false },
    ]);
  });

  it("SRCH-02: every occurrence is marked, not just the first", () => {
    expect(highlightParts("ana banana", "ana")).toEqual([
      { text: "ana", match: true },
      { text: " b", match: false },
      { text: "ana", match: true },
      { text: "na", match: false },
    ]);
  });

  it("SRCH-02: the query is matched LITERALLY — no regex is compiled from user input", () => {
    expect(highlightParts("a.b", ".*")).toEqual([{ text: "a.b", match: false }]);
    expect(highlightParts("100% off", "%")).toEqual([
      { text: "100", match: false },
      { text: "%", match: true },
      { text: " off", match: false },
    ]);
    // An unbalanced regex metacharacter must not throw.
    expect(() => highlightParts("f(x)", "(")).not.toThrow();
  });

  it("SRCH-02: markup in the text stays TEXT — the splitter never produces HTML (PRN-10)", () => {
    const parts = highlightParts("<img src=x onerror=alert(1)> Lane", "lane");
    expect(parts.map((p) => p.text).join("")).toBe("<img src=x onerror=alert(1)> Lane");
    expect(parts.at(-1)).toEqual({ text: "Lane", match: true });
  });

  it("SRCH-02: an empty query or empty text degrades safely", () => {
    expect(highlightParts("Marcus", "")).toEqual([{ text: "Marcus", match: false }]);
    expect(highlightParts("", "abc")).toEqual([]);
  });
});
