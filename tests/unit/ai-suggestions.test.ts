import { describe, it, expect } from "vitest";
import { suggestionsFor } from "@/modules/ai/suggestions";

describe("contextual suggestions (owner: chips change with the screen)", () => {
  it("dashboard gets performance/coverage asks", () => {
    expect(suggestionsFor("dashboard")).toContain("Which states have no coverage?");
  });
  it("import screens ask about the last import", () => {
    expect(suggestionsFor("import_detail")).toContain("Why were leads removed from this import?");
  });
  it("unknown/undefined screens get the generic set (3-4 chips, always includes explain)", () => {
    const s = suggestionsFor(undefined);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(4);
    expect(s).toContain("Explain this screen");
  });
});
