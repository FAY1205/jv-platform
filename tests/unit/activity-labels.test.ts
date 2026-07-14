import { describe, expect, it } from "vitest";
import { ACTION_LABELS, activityActionLabel, activityEntityLabel, ENTITY_LABELS } from "@/modules/activity/labels";

// ACT-01/04 (T6): the activity trail reads as sentences, not machine strings.
describe("activity labels", () => {
  it("ACT-01: every known action label is a human sentence (no dots/underscores)", () => {
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      expect(activityActionLabel(action)).toBe(label);
      expect(label).not.toMatch(/[._]/);
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });

  it("ACT-01: unknown actions degrade to prettified words, never raw dot-strings", () => {
    expect(activityActionLabel("auth.password_changed")).toBe("Auth password changed");
    expect(activityActionLabel("")).toBe("");
  });

  it("ACT-01: entity types read as product words (upload → Import)", () => {
    expect(activityEntityLabel("upload")).toBe("Import");
    expect(activityEntityLabel("lead_note")).toBe("Note");
    expect(activityEntityLabel("brand_new_thing")).toBe("Brand new thing");
    for (const label of Object.values(ENTITY_LABELS)) expect(label).not.toMatch(/[._]/);
  });
});
