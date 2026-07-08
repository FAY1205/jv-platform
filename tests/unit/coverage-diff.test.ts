import { describe, expect, it } from "vitest";
import { parseZipList, parseStateList } from "@/modules/coverage/parse";
import { diffPartnerCoverage } from "@/modules/coverage/diff";

// CVG-01 (per-partner entry): the owner types the ZIPs/states a partner covers;
// the coverage set is normalized and diffed against current before a versioned apply.
describe("parseZipList", () => {
  it("CVG-01: splits on commas/spaces/newlines, normalizes, dedupes", () => {
    const r = parseZipList("75001, 75002\n75001  6404");
    expect(r.valid).toEqual(["75001", "75002", "06404"]); // 6404 → 06404 (NRM-01), 75001 deduped
    expect(r.invalid).toEqual([]);
  });

  it("CVG-01: flags non-ZIP tokens as invalid", () => {
    const r = parseZipList("75001, abc, 12");
    expect(r.valid).toEqual(["75001"]);
    expect(r.invalid).toEqual(["abc", "12"]);
  });
});

describe("parseStateList", () => {
  it("CVG-01: normalizes names + codes to 2-letter, dedupes", () => {
    const r = parseStateList("TX, texas, California");
    expect(r.valid).toEqual(["TX", "CA"]);
  });
});

describe("diffPartnerCoverage (ZIPs)", () => {
  const current = new Map<string, string>([
    ["75001", "P1"], // owned by this partner
    ["75002", "P1"], // owned by this partner — to be removed (omitted)
    ["60601", "P2"], // owned by another partner — will be reassigned
  ]);

  it("CVG-01: computes add / reassign / keep / remove against current", () => {
    const d = diffPartnerCoverage(["75001", "60601", "90210"], current, "P1");
    expect(d.add).toEqual(["90210"]); // not covered anywhere
    expect(d.reassign).toEqual([{ zip: "60601", fromPartnerId: "P2" }]); // taken from P2
    expect(d.keep).toEqual(["75001"]); // already this partner's
    expect(d.remove).toEqual(["75002"]); // this partner's, but omitted now
  });

  it("CVG-01: an empty entry removes all of this partner's current ZIPs", () => {
    const d = diffPartnerCoverage([], current, "P1");
    expect(d.remove.sort()).toEqual(["75001", "75002"]);
    expect(d.add).toEqual([]);
  });
});
