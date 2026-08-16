// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/data" }));

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

  it("UX5-01b: the platform-owner Invitations item reaches both renders", () => {
    const { container } = render(<SettingsNav isPlatformOwner />);
    expect(screen.getAllByRole("link", { name: "Invitations" })).toHaveLength(2);
    expect(container.querySelector(".lg\\:hidden")!.querySelectorAll("a")).toHaveLength(11);
  });
});
