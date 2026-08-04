// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "@/components/AppShell";

// The shell nav is grouped by the weekly job (audit F-63). Assert the structure directly —
// a full AppShell render pulls in many async data deps; the grouping is the load-bearing fix.
describe("F-63: shell nav", () => {
  it("F-63: groups the rail Route / Review / Network / Admin", () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(["Route", "Review", "Network", "Admin"]);
  });

  it("F-63: Route holds Dashboard + Leads; Review holds Unmatched + Imports", () => {
    expect(NAV_SECTIONS[0].items.map((i) => i.href)).toEqual(["/dashboard", "/leads"]);
    expect(NAV_SECTIONS[1].items.map((i) => i.href)).toEqual(["/unmatched", "/imports"]);
  });

  it("F-63: Leads carries a total badge, Unmatched a warn badge", () => {
    const leads = NAV_SECTIONS[0].items.find((i) => i.href === "/leads");
    const unmatched = NAV_SECTIONS[1].items.find((i) => i.href === "/unmatched");
    expect(leads?.badge).toBe("leads");
    expect(unmatched?.badge).toBe("unmatched");
  });
});
