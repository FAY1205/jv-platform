import { describe, expect, it } from "vitest";
import { formatPartnerRef, formatLeadRef, formatUploadRef } from "@/db/ref-ids";

// DM-07: human-readable reference ID formats.
describe("DM-07: reference ID formatting", () => {
  it("formats partner refs as JV-### (min 3 digits)", () => {
    expect(formatPartnerRef(3)).toBe("JV-003");
    expect(formatPartnerRef(12)).toBe("JV-012");
    expect(formatPartnerRef(1234)).toBe("JV-1234"); // pad-only, never truncates
  });

  it("formats lead refs as LD-YYYY-##### (min 5 digits)", () => {
    expect(formatLeadRef(2026, 42)).toBe("LD-2026-00042");
    expect(formatLeadRef(2026, 12345)).toBe("LD-2026-12345");
  });

  it("formats upload refs as UP-YYYY-### (min 3 digits)", () => {
    expect(formatUploadRef(2026, 14)).toBe("UP-2026-014");
  });
});
