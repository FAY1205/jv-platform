import { describe, expect, it } from "vitest";
import { notificationTone } from "@/lib/notification-visual";

describe("notificationTone", () => {
  it("maps known notification types to tones", () => {
    expect(notificationTone("run_summary")).toBe("success");
    expect(notificationTone("new_leads")).toBe("route");
    expect(notificationTone("assigned_lead")).toBe("route");
    expect(notificationTone("status_change")).toBe("info");
  });

  it("falls back to neutral for an unknown type", () => {
    expect(notificationTone("something_unmapped")).toBe("neutral");
  });
});
