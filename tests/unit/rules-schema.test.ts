import { describe, expect, it } from "vitest";
import { MlsPatternUpdateSchema } from "@/modules/rules/schema";

// CVG-02: validation for the editable Rules area (MLS on/off + label). Campaign
// recodes were removed (ADR-0018).
describe("MlsPatternUpdateSchema", () => {
  it("CVG-02: allows toggling enabled and/or editing the label, but not the regex", () => {
    expect(MlsPatternUpdateSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(MlsPatternUpdateSchema.parse({ label: "Listed: Yes" }).label).toBe("Listed: Yes");
    // regex is not an accepted field — it's stripped, never editable at runtime (PRN-04).
    const parsed = MlsPatternUpdateSchema.parse({ enabled: true, regex: "evil.*" } as Record<string, unknown>);
    expect("regex" in parsed).toBe(false);
  });

  it("CVG-02: rejects an empty label", () => {
    expect(MlsPatternUpdateSchema.safeParse({ label: "   " }).success).toBe(false);
  });
});
