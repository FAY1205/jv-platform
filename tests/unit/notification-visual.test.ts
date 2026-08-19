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

  it("NTF-11: the four WP-NF2 types are mapped deliberately, not by the unknown fallback", () => {
    // task_assigned joins new_leads/assigned_lead: work landing in your queue is the same
    // event as a lead landing in it, and the arrow-into-tray glyph already says so.
    expect(notificationTone("task_assigned")).toBe("route");
    // A partner note is activity on a lead someone is working — status_change's register.
    expect(notificationTone("partner_note")).toBe("info");
    // ONE tone for both import outcomes, because they share one `type` string and the tile is
    // keyed on the type. Neutral, not success (no green tick on "Import failed: …") and not
    // hot/warn (that mark means hot LEAD everywhere else) — the same reasoning that made
    // task_reminder_orphaned neutral. The title carries the outcome (PRN-14).
    expect(notificationTone("import_result")).toBe("neutral");
    // A completed onboarding is the one genuinely celebratory event of the four.
    expect(notificationTone("partner_activated")).toBe("success");
  });

  it("PRN-14: every mapped type reuses an existing AA-gated tone (no colour-only new family)", () => {
    const tones = ["route", "success", "info", "neutral", "hot"];
    for (const type of [
      "run_summary",
      "new_leads",
      "assigned_lead",
      "status_change",
      "hot_leads",
      "task_due",
      "task_reminder_orphaned",
      "task_assigned",
      "partner_note",
      "import_result",
      "partner_activated",
    ]) {
      expect(tones).toContain(notificationTone(type));
    }
  });

  it("falls back to neutral for an unknown type", () => {
    expect(notificationTone("something_unmapped")).toBe("neutral");
  });
});
