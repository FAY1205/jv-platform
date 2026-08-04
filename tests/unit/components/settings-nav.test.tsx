// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings/data" }));

import { SettingsNav } from "@/app/(admin)/settings/settings-nav";

describe("SettingsNav", () => {
  it("groups sections under Account and Organization", () => {
    render(<SettingsNav />);
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    // Workspace sits under Account, Data & Export under Organization.
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/settings/workspace");
    expect(screen.getByRole("link", { name: "Data & Export" })).toHaveAttribute("href", "/settings/data");
  });

  it("marks the active section from the URL", () => {
    render(<SettingsNav />);
    expect(screen.getByRole("link", { name: "Data & Export" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute("aria-current");
  });
});
