import { describe, expect, it } from "vitest";
import { buildPartnerTerritory } from "@/modules/coverage/partner-territory";

const PARTNER = { id: "p1", name: "Summit Partners", refId: "JV-091", color: "#C79A3E" };

describe("PTL/PRN-08: scoped partner territory", () => {
  const t = buildPartnerTerritory({ ownStates: ["WA", "OR", "ID"], partner: PARTNER });

  it("identifies the partner's own states with name + ref + color (PRN-14)", () => {
    const wa = t.states.find((s) => s.code === "WA")!;
    expect(wa).toMatchObject({ partnerId: "p1", partnerName: "Summit Partners", refId: "JV-091", color: "#C79A3E" });
    expect(t.ownStateCount).toBe(3);
  });

  it("PRN-08: every non-owned state is anonymized — no other partner's identity leaks", () => {
    for (const s of t.states.filter((x) => !["WA", "OR", "ID"].includes(x.code))) {
      expect(s.partnerId).toBeNull();
      expect(s.partnerName).toBeNull();
      expect(s.refId).toBeNull();
      expect(s.color).toBeNull();
      expect(s.gap).toBe(false); // portal never shows the coverage-gap hatch
    }
  });

  it("covers all 51 hex states (50 + DC)", () => {
    expect(t.states).toHaveLength(51);
  });

  it("has no counties when no ZIPs / resolver are supplied (state-only territory)", () => {
    expect(t.counties).toEqual([]);
  });

  it("WP-E: resolves the partner's own ZIPs to their counties, all in the partner's color (no leak)", () => {
    // 53033 = King County WA (98101); 41051 = Multnomah County OR (97201).
    const xwalk: Record<string, string> = { "98101": "53033", "97201": "41051" };
    const tt = buildPartnerTerritory({
      ownStates: ["WA"],
      ownZips: ["98101", "97201"],
      partner: PARTNER,
      zipToCounty: (z) => xwalk[z] ?? null,
    });
    expect(tt.counties.map((c) => c.fips).sort()).toEqual(["41051", "53033"]);
    expect(tt.counties.every((c) => c.partnerId === "p1" && c.color === "#C79A3E")).toBe(true);
  });
});
