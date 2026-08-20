// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/data" }));

// Phase C: the nav consults the client capability list to hide the ONE whole-route
// exception (Settings → Team). Mocked here so the nav's own assertions stay about routing.
const { canDo } = vi.hoisted(() => ({ canDo: vi.fn(() => true) }));
vi.mock("@/lib/use-current-user", () => ({ useCurrentUser: () => ({ canDo }) }));

import { SettingsNav } from "@/app/(admin)/settings/settings-nav";

// WP-UX-5 (audit S-1, the series' one Critical): the nav renders TWICE from one item
// list — a horizontally scrollable pill strip below `lg` (the grouped sidebar used to
// linearize ABOVE the content, ~1,100px of nav before the first card) and the grouped
// sidebar on `lg+`. Every item-level assertion therefore checks both renders.

describe("SettingsNav", () => {
  it("groups sections under Account and Organization (sidebar render)", () => {
    render(<SettingsNav />);
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "Workspace" })) {
      expect(link).toHaveAttribute("href", "/settings/workspace");
    }
    for (const link of screen.getAllByRole("link", { name: "Data & Export" })) {
      expect(link).toHaveAttribute("href", "/settings/data");
    }
  });

  it("marks the active section from the URL — in BOTH renders", () => {
    render(<SettingsNav />);
    const active = screen.getAllByRole("link", { name: "Data & Export" });
    expect(active).toHaveLength(2);
    for (const link of active) expect(link).toHaveAttribute("aria-current", "page");
    for (const link of screen.getAllByRole("link", { name: "Profile" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("UX5-01: the pill strip is the narrow-width render (lg:hidden, horizontal scroll); the grouped sidebar is lg-only", () => {
    const { container } = render(<SettingsNav />);
    const strip = container.querySelector(".lg\\:hidden");
    expect(strip).not.toBeNull();
    expect(strip!.className).toContain("overflow-x-auto");
    // Flat: the strip carries every item (10) with no group headers inside it.
    expect(strip!.querySelectorAll("a")).toHaveLength(10);
    const sidebar = container.querySelector(".lg\\:flex");
    expect(sidebar).not.toBeNull();
    expect(sidebar!.className).toContain("hidden");
  });

  it("TM-13: the Team item is hidden without team.manage (the §6 whole-route exception)", () => {
    canDo.mockReturnValue(false);
    try {
      const { container } = render(<SettingsNav />);
      expect(screen.queryByRole("link", { name: "Team" })).toBeNull();
      expect(container.querySelector(".lg\\:hidden")!.querySelectorAll("a")).toHaveLength(9);
    } finally {
      canDo.mockReturnValue(true);
    }
  });

  it("TM-13: the Team item appears (no Soon pill) for a caller with team.manage", () => {
    render(<SettingsNav />);
    for (const link of screen.getAllByRole("link", { name: "Team" })) {
      expect(link).toHaveAttribute("href", "/settings/team");
      expect(link.textContent).not.toContain("Soon");
    }
  });

  it("WP-NF2b: Notifications stays visible with EVERY capability denied — Team is the only hidden item", () => {
    // Load-bearing, and easy to break by accident. /settings/notifications is now the PERSONAL
    // notification-preferences page (ADR-0053): it edits only the caller's own overlay through
    // the un-gated /api/me/notification-prefs, so every admin-stream seat — member and viewer
    // included — must be able to reach it. Nothing in the page or the route enforces that; it
    // holds because the hub gates on the PRN-13 STREAM (the `(admin)` route group) rather than
    // on tier, and because this nav item carries no `requires`.
    //
    // So: with `canDo` denying everything — the viewer floor — the item must still render in
    // BOTH nav renders, while Team (the §6 whole-route exception, which genuinely requires
    // team.manage) must not. Adding `requires:` to the Notifications item would strand every
    // member/viewer seat with no way to turn off their own email; this fails if someone does.
    canDo.mockReturnValue(false);
    try {
      render(<SettingsNav />);
      const items = screen.getAllByRole("link", { name: "Notifications" });
      expect(items).toHaveLength(2); // pill strip + grouped sidebar
      for (const link of items) expect(link).toHaveAttribute("href", "/settings/notifications");
      expect(screen.queryByRole("link", { name: "Team" })).toBeNull();
    } finally {
      canDo.mockReturnValue(true);
    }
  });

  it("UX5-01b: the platform-owner Invitations item reaches both renders", () => {
    const { container } = render(<SettingsNav isPlatformOwner />);
    expect(screen.getAllByRole("link", { name: "Invitations" })).toHaveLength(2);
    expect(container.querySelector(".lg\\:hidden")!.querySelectorAll("a")).toHaveLength(11);
  });
});
