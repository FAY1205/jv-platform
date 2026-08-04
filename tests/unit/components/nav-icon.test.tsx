// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NavIcon, NAV_ICON_NAMES } from "@/components/NavIcon";

// VP-1 (portal visual parity): ONE icon source for both shells. AppShell and PortalShell
// each hand-drew their own glyphs (same stroke style, different drawings) — the owner's
// "navigation icons are different" complaint. The module owns the drawing; the call site
// owns the size (portal renders 18px desktop / 22px mobile).
describe("VP-1: NavIcon shared nav icon module", () => {
  it("renders every name as a decorative stroked svg with the caller's size class", () => {
    for (const name of NAV_ICON_NAMES) {
      const { container, unmount } = render(<NavIcon name={name} className="h-[18px] w-[18px]" />);
      const svg = container.querySelector("svg")!;
      expect(svg, name).not.toBeNull();
      expect(svg.getAttribute("aria-hidden"), name).toBe("true");
      expect(svg.getAttribute("stroke-width"), name).toBe("1.85");
      expect(svg.getAttribute("viewBox"), name).toBe("0 0 24 24");
      expect(svg.getAttribute("class"), name).toContain("h-[18px]");
      unmount();
    }
  });

  it("dashboard is the admin bento-tile drawing (4 rects) — the canonical glyph set", () => {
    const { container } = render(<NavIcon name="dashboard" className="h-4 w-4" />);
    expect(container.querySelectorAll("rect")).toHaveLength(4);
  });

  it("covers both shells' needs, including the portal-only account glyph", () => {
    expect(NAV_ICON_NAMES).toContain("account");
    expect(NAV_ICON_NAMES).toContain("menu");
    expect(NAV_ICON_NAMES).toContain("leads");
  });
});
