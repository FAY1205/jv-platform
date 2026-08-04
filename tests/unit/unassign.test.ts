import { describe, it, expect } from "vitest";
import { offersUnassign } from "@/lib/unassign";

// The admin lead-edit dialog offers "Unassigned" only when it can actually succeed.
// Unassign clears the additive manual overlay; PRN-05 forbids nulling the immutable
// pipeline snapshot, so a lead that has a pipeline-snapshot owner can never be made
// owner-less (the server returns 409). This mirrors that server guard in the UI.

describe("offersUnassign (admin lead-edit partner select)", () => {
  it("PRN-05: offers Unassign for a manually-assigned unmatched-base lead (overlay, no pipeline owner)", () => {
    expect(offersUnassign({ manual: true, hasOriginal: false, hasEffectiveOwner: true })).toBe(true);
  });

  it("PRN-05: offers Unassign for a lead with no owner at all (already unmatched)", () => {
    expect(offersUnassign({ manual: false, hasOriginal: false, hasEffectiveOwner: false })).toBe(true);
  });

  it("PRN-05: withholds Unassign for a pure pipeline-routed lead (snapshot owner can't be nulled)", () => {
    expect(offersUnassign({ manual: false, hasOriginal: false, hasEffectiveOwner: true })).toBe(false);
  });

  it("PRN-05: withholds Unassign when a manual overlay sits atop a pipeline snapshot (use Revert instead)", () => {
    expect(offersUnassign({ manual: true, hasOriginal: true, hasEffectiveOwner: true })).toBe(false);
  });
});
