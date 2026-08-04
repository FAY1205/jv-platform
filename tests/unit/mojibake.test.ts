import { describe, expect, it } from "vitest";
import { repairMojibake } from "@/modules/sources/mojibake";

// FU-1: the CRM export bakes UTF-8 text mis-encoded as Windows-1252 into cells (the
// "⚠️ …" headers and the notes blob come through as "âš ï¸ …"). repairMojibake reverses
// that round-trip — but ONLY when the reversed bytes form valid UTF-8, so genuine text
// (including legitimately accented words and already-correct emoji) is never corrupted.
describe("FU-1: repairMojibake (reverse UTF-8-as-Windows-1252)", () => {
  it("repairs the confirmed ⚠️ mojibake from the real export", () => {
    // U+00E2 U+0161 U+00A0 U+00EF U+00B8 U+008F  →  ⚠️ (U+26A0 U+FE0F)
    expect(repairMojibake("âš ï¸ Dispo Key Notes")).toBe("⚠️ Dispo Key Notes");
  });

  it("repairs a curly-apostrophe mojibake (â€™ → ’)", () => {
    expect(repairMojibake("Itâ€™s time")).toBe("It’s time");
  });

  it("leaves pure ASCII untouched", () => {
    expect(repairMojibake("Reason for selling: relocation")).toBe("Reason for selling: relocation");
  });

  it("leaves legitimately accented text untouched (would not round-trip to valid UTF-8)", () => {
    expect(repairMojibake("café au lait")).toBe("café au lait");
    expect(repairMojibake("Œuvre")).toBe("Œuvre");
  });

  it("leaves already-correct emoji untouched", () => {
    expect(repairMojibake("⚠️ heads up")).toBe("⚠️ heads up");
  });

  it("is idempotent — repairing repaired text changes nothing", () => {
    const once = repairMojibake("âš ï¸ x");
    expect(repairMojibake(once)).toBe(once);
  });
});
