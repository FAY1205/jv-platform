// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockPath = "/portal/leads";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));

import { PortalShell } from "@/components";

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalShell>
        <p>page body</p>
      </PortalShell>
    </QueryClientProvider>,
  );
}

describe("PortalShell", () => {
  it("F-66: renders the four bottom tabs as a labeled nav", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    expect(screen.getByRole("navigation", { name: "Portal" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/portal/dashboard");
    expect(screen.getByRole("link", { name: "Leads" })).toHaveAttribute("href", "/portal/leads");
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/portal/activity");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/portal");
  });

  it("WP-F.3: marks the Dashboard tab current on /portal/dashboard", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Leads" })).not.toHaveAttribute("aria-current");
  });

  it("marks the active tab from the URL", () => {
    mockPath = "/portal/leads";
    renderShell();
    expect(screen.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Activity" })).not.toHaveAttribute("aria-current");
  });

  it("hides the shell chrome on the pre-auth login route", () => {
    mockPath = "/portal/login";
    renderShell();
    expect(screen.queryByRole("navigation", { name: "Portal" })).toBeNull();
    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});
