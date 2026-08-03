import { describe, expect, it } from "vitest";
import { buildCountyCoverage } from "@/modules/coverage/county";

// WP-E (owner note #6): resolve a partner's ZIP coverage to county-level ownership so the map can
// color the actual county a partner covers, not just tint the whole state. PURE — the zip→county
// resolver is injected (PRN-01).

const P = [
  { id: "p1", name: "Alpha", refId: "PR-001", color: "#111111" },
  { id: "p2", name: "Bravo", refId: "PR-002", color: "#222222" },
];
// 48113 = Dallas County TX; 06037 = Los Angeles County CA.
const XWALK: Record<string, string> = { "75001": "48113", "75002": "48113", "75006": "48113", "90210": "06037" };
const z2c = (z: string) => XWALK[z] ?? null;

describe("buildCountyCoverage", () => {
  it("assigns a county to the partner whose ZIP falls in it", () => {
    expect(buildCountyCoverage([{ zip5: "90210", partnerId: "p1" }], P, z2c)).toEqual([
      { fips: "06037", partnerId: "p1", partnerName: "Alpha", refId: "PR-001", color: "#111111" },
    ]);
  });

  it("assigns a shared county by plurality (most ZIPs wins)", () => {
    const out = buildCountyCoverage(
      [
        { zip5: "75001", partnerId: "p1" },
        { zip5: "75002", partnerId: "p1" },
        { zip5: "75006", partnerId: "p2" },
      ],
      P,
      z2c,
    );
    expect(out.find((c) => c.fips === "48113")!.partnerId).toBe("p1"); // 2 vs 1
  });

  it("breaks a tie deterministically by the lower partner ref", () => {
    const out = buildCountyCoverage(
      [
        { zip5: "75001", partnerId: "p2" },
        { zip5: "75002", partnerId: "p1" },
      ],
      P,
      z2c,
    );
    expect(out.find((c) => c.fips === "48113")!.partnerId).toBe("p1"); // PR-001 < PR-002
  });

  it("skips ZIPs not in the crosswalk and ZIPs of unknown partners", () => {
    expect(
      buildCountyCoverage(
        [
          { zip5: "00000", partnerId: "p1" }, // not in crosswalk
          { zip5: "90210", partnerId: "ghost" }, // unknown partner
        ],
        P,
        z2c,
      ),
    ).toEqual([]);
  });
});
