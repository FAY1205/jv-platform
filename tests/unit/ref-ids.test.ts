import { describe, expect, it } from "vitest";
import { formatPartnerRef, formatLeadRef, formatImportRef } from "@/db/ref-ids";

// DM-07 / ADR-0019: human-readable reference ID formats (v2 — 2-digit year, IM- imports).
describe("DM-07: reference ID formatting", () => {
  it("formats partner refs as PR-### (min 3 digits; JV-→PR- rename, migration 0022)", () => {
    expect(formatPartnerRef(3)).toBe("PR-003");
    expect(formatPartnerRef(12)).toBe("PR-012");
    expect(formatPartnerRef(1234)).toBe("PR-1234"); // pad-only, never truncates
  });

  it("formats lead refs as LD-YY-##### (2-digit year, min 5 digits)", () => {
    expect(formatLeadRef(2026, 42)).toBe("LD-26-00042");
    expect(formatLeadRef(2026, 12345)).toBe("LD-26-12345");
  });

  it("formats import refs as IM-YY-### (2-digit year, min 3 digits)", () => {
    expect(formatImportRef(2026, 14)).toBe("IM-26-014");
  });
});
