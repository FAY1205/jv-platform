import { describe, expect, it } from "vitest";
import { RecodeSchema, MlsPatternUpdateSchema } from "@/modules/rules/schema";

// CVG-02: validation for the editable Rules area (recodes CRUD, MLS on/off + label).
describe("RecodeSchema", () => {
  it("CVG-02: requires a match pattern and a code, trimming both", () => {
    expect(RecodeSchema.safeParse({ matchPattern: "  ", code: "Z" }).success).toBe(false);
    expect(RecodeSchema.safeParse({ matchPattern: "Lead Zolo*", code: "  " }).success).toBe(false);
    const ok = RecodeSchema.parse({ matchPattern: "  Lead Zolo*  ", code: "  Z  " });
    expect(ok).toEqual({ matchPattern: "Lead Zolo*", code: "Z" });
  });
});

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
