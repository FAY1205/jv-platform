import { describe, expect, it } from "vitest";
import { screenForPath } from "@/modules/ai/screen";

describe("WP-AI-2 screenForPath", () => {
  it("maps the dashboard root and /dashboard", () => {
    expect(screenForPath("/")).toBe("dashboard");
    expect(screenForPath("/dashboard")).toBe("dashboard");
  });
  it("maps list pages", () => {
    expect(screenForPath("/leads")).toBe("leads");
    expect(screenForPath("/unmatched")).toBe("unmatched");
    expect(screenForPath("/partners")).toBe("partners");
    expect(screenForPath("/coverage")).toBe("coverage");
    expect(screenForPath("/rules")).toBe("rules");
    expect(screenForPath("/activity")).toBe("activity");
    expect(screenForPath("/upload")).toBe("upload");
  });
  it("maps detail pages to their detail screen", () => {
    expect(screenForPath("/imports")).toBe("imports");
    expect(screenForPath("/imports/IM-26-004")).toBe("import_detail");
    expect(screenForPath("/partners/abc-123")).toBe("partner_detail");
  });
  it("maps a lead detail to the leads screen (no lead_detail catalog key)", () => {
    expect(screenForPath("/leads/LD-26-00042")).toBe("leads");
  });
  it("maps any settings sub-page to settings", () => {
    expect(screenForPath("/settings")).toBe("settings");
    expect(screenForPath("/settings/ai")).toBe("settings");
  });
  it("returns undefined for unknown or non-app routes", () => {
    expect(screenForPath("/gallery/assistant")).toBeUndefined();
    expect(screenForPath("/portal/leads")).toBeUndefined();
    expect(screenForPath("")).toBeUndefined();
  });
});
