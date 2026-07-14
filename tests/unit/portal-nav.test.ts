import { describe, expect, it } from "vitest";
import { portalTitleForPath } from "@/lib/portal-nav";

describe("WP-PW-1 portalTitleForPath", () => {
  it("PW-01: maps the four sections to their titles", () => {
    expect(portalTitleForPath("/portal/dashboard")).toBe("Dashboard");
    expect(portalTitleForPath("/portal/leads")).toBe("Leads");
    expect(portalTitleForPath("/portal/activity")).toBe("Activity");
    expect(portalTitleForPath("/portal")).toBe("Account");
  });
  it("PW-01: maps sub-routes to their section title (sections without detail routes)", () => {
    expect(portalTitleForPath("/portal/activity?page=2")).toBe("Activity");
    expect(portalTitleForPath("/portal/devices")).toBe("Devices");
  });
  // Detail routes own their own <h1> in the page body, so the top bar renders no title.
  it("PW-01: returns null for the leads DETAIL route (page body owns the title)", () => {
    expect(portalTitleForPath("/portal/leads/LD-26-00042")).toBeNull();
  });
  it("PW-01: returns null for the bare (chrome-less) routes", () => {
    expect(portalTitleForPath("/portal/login")).toBeNull();
    expect(portalTitleForPath("/portal/tos")).toBeNull();
  });
  it("PW-01: returns null for unknown routes", () => {
    expect(portalTitleForPath("/dashboard")).toBeNull();
    expect(portalTitleForPath("")).toBeNull();
  });
});
