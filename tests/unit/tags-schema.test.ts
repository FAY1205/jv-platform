import { describe, it, expect } from "vitest";
import {
  CreateTagSchema, UpdateTagSchema, AttachTagSchema, tagsParam, TAG_FILTER_MAX, TAG_NAME_MAX,
} from "@/modules/tags/schema";
import { LeadsQuerySchema, BoardQuerySchema } from "@/modules/leads/schema";
import { TAG_PALETTE, isTagColor, nextTagColor } from "@/lib/tokens/tokens";
import { tagChipClass, tagDotClass } from "@/lib/tag-chip";

// WP-TAG-1 — the pure boundary: the Zod contracts, the shared `?tags=` parser (which BOTH
// the list and the board schemas embed), the palette's round-robin, and the chip class map.

describe("TAG-03: tag body contracts", () => {
  it("TAG-01: a name is trimmed, non-empty, and capped at 40", () => {
    expect(CreateTagSchema.parse({ name: "  Probate " }).name).toBe("Probate");
    expect(CreateTagSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(CreateTagSchema.safeParse({ name: "x".repeat(TAG_NAME_MAX) }).success).toBe(true);
    expect(CreateTagSchema.safeParse({ name: "x".repeat(TAG_NAME_MAX + 1) }).success).toBe(false);
  });

  it("TAG-01: color must be a PALETTE KEY — a hex is refused, so no hex ever reaches a row", () => {
    expect(CreateTagSchema.safeParse({ name: "ok", color: TAG_PALETTE[0] }).success).toBe(true);
    expect(CreateTagSchema.safeParse({ name: "ok", color: "#B4623F" }).success).toBe(false);
    expect(CreateTagSchema.safeParse({ name: "ok", color: "chartreuse" }).success).toBe(false);
  });

  it("TAG-03: create/update/attach bodies are STRICT — an unknown key is a 400, not a no-op", () => {
    expect(CreateTagSchema.safeParse({ name: "ok", extra: 1 }).success).toBe(false);
    expect(UpdateTagSchema.safeParse({ name: "ok", extra: 1 }).success).toBe(false);
    expect(AttachTagSchema.safeParse({ tagId: crypto.randomUUID(), extra: 1 }).success).toBe(false);
  });

  it("TAG-06: an empty update body is refused (nothing to change)", () => {
    expect(UpdateTagSchema.safeParse({}).success).toBe(false);
    expect(UpdateTagSchema.safeParse({ name: "New" }).success).toBe(true);
    expect(UpdateTagSchema.safeParse({ color: TAG_PALETTE[1] }).success).toBe(true);
  });

  it("TAG-03: attach requires a uuid tag id", () => {
    expect(AttachTagSchema.safeParse({ tagId: "nope" }).success).toBe(false);
  });
});

describe("TAG-03: the shared ?tags= parser", () => {
  const p = tagsParam();
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";

  it("parses a comma-separated uuid list and lower-cases it", () => {
    expect(p.parse(`${a},${b.toUpperCase()}`)).toEqual([a, b]);
  });

  it("drops junk instead of erroring — a filter UI degrades, it never 400s", () => {
    expect(p.parse("not-a-uuid")).toEqual([]);
    expect(p.parse(undefined)).toEqual([]);
    expect(p.parse(42)).toEqual([]);
    expect(p.parse(`${a},garbage`)).toEqual([a]);
  });

  it("de-duplicates and caps the list so a crafted URL can't widen the query", () => {
    expect(p.parse(`${a},${a},${a}`)).toEqual([a]);
    const many = Array.from({ length: TAG_FILTER_MAX + 5 }, (_, i) => `1111111${i % 10}-1111-4111-8111-11111111111${i % 10}`);
    expect(p.parse(many.join(",")).length).toBeLessThanOrEqual(TAG_FILTER_MAX);
  });

  it("TAG-03: the LIST and the BOARD embed the SAME parser — `?tags=` means one thing", () => {
    expect(LeadsQuerySchema.parse({ tags: `${a},${b}` }).tags).toEqual([a, b]);
    expect(BoardQuerySchema.parse({ tags: `${a},${b}` }).tags).toEqual([a, b]);
    expect(LeadsQuerySchema.parse({}).tags).toEqual([]);
    expect(BoardQuerySchema.parse({}).tags).toEqual([]);
  });
});

describe("TAG-04: the fixed palette", () => {
  it("round-robins by existing count, wrapping at the palette length", () => {
    for (let i = 0; i < TAG_PALETTE.length; i++) expect(nextTagColor(i)).toBe(TAG_PALETTE[i]);
    expect(nextTagColor(TAG_PALETTE.length)).toBe(TAG_PALETTE[0]);
    expect(nextTagColor(TAG_PALETTE.length * 3 + 2)).toBe(TAG_PALETTE[2]);
  });

  it("PRN-12: every palette key resolves to SEMANTIC TOKEN utilities — no hex in the map", () => {
    for (const c of TAG_PALETTE) {
      expect(isTagColor(c)).toBe(true);
      expect(tagChipClass(c)).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(tagDotClass(c)).not.toMatch(/#[0-9a-f]{3,8}/i);
      // A chip is a fill + ink pair, so the label always keeps its contrast.
      expect(tagChipClass(c)).toMatch(/\btext-/);
      expect(tagChipClass(c)).toMatch(/\bbg-/);
    }
  });

  it("an unknown/legacy key degrades to a neutral chip — data outlives palettes", () => {
    expect(isTagColor("chartreuse")).toBe(false);
    expect(tagChipClass("chartreuse")).toContain("bg-surface-3");
    expect(tagDotClass("chartreuse")).toBe("bg-text-3");
  });
});
