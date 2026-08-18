import { describe, expect, it } from "vitest";
import { notificationTone } from "@/lib/notification-visual";

describe("notificationTone", () => {
  it("maps known notification types to tones", () => {
    expect(notificationTone("run_summary")).toBe("success");
    expect(notificationTone("new_leads")).toBe("route");
    expect(notificationTone("assigned_lead")).toBe("route");
    expect(notificationTone("status_change")).toBe("info");
    expect(notificationTone("hot_leads")).toBe("hot");
  });

  it("NTF-04/TSK-08: both task types are mapped, not left to the unknown-type fallback", () => {
    // WP-NF1 D6: task_due and task_reminder_orphaned have existed since WP-TSK-6/6a but were
    // never added here, so they silently rendered as the "unknown type" bell. task_due joins
    // the info family (activity about your own committed work); the orphan heads-up stays
    // neutral ON PURPOSE — `hot` is the hot-LEAD target mark everywhere else, and an ops
    // warning must not read as a sales opportunity.
    expect(notificationTone("task_due")).toBe("info");
    expect(notificationTone("task_reminder_orphaned")).toBe("neutral");
  });

  it("PRN-14: every mapped type reuses an existing AA-gated tone (no colour-only new family)", () => {
    const tones = ["route", "success", "info", "neutral", "hot"];
    for (const type of ["run_summary", "new_leads", "assigned_lead", "status_change", "hot_leads", "task_due", "task_reminder_orphaned"]) {
      expect(tones).toContain(notificationTone(type));
    }
  });

  it("falls back to neutral for an unknown type", () => {
    expect(notificationTone("something_unmapped")).toBe("neutral");
  });
});
