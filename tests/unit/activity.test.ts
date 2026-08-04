import { describe, expect, it } from "vitest";
import { categorizeActivity } from "@/modules/activity/categorize";

// ACT-04: security-relevant events (rules/profile/coverage changes, deactivations,
// voids, note edits) are highlighted; routine data edits are not.
describe("categorizeActivity", () => {
  it("ACT-04: flags rules / profile / coverage / lifecycle changes as security", () => {
    for (const a of ["mls_pattern.updated", "source_profile.saved", "partner.deactivated", "partner.coverage_updated", "upload.voided", "note.edited"]) {
      expect(categorizeActivity(a)).toBe("security");
    }
  });

  it("ACT-04: routine edits are data, not security", () => {
    for (const a of ["partner.created", "partner.updated", "status.changed", "note.added"]) {
      expect(categorizeActivity(a)).toBe("data");
    }
  });
});
