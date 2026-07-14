// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockPath = "/portal/leads";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn(async () => ({ email: "ops@meridianbuyers.com", role: "partner", workspace: { name: "Meridian Buyers" } })) }));

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

// WP-PW-1 note: at md+ the shell renders BOTH a desktop rail nav and the mobile bottom-tab
// nav (each labeled "Portal") in one single-render tree — jsdom applies no compiled Tailwind
// CSS, so `md:hidden` / `hidden md:flex` don't actually hide either. Assertions below use
// getAllByRole and check every match rather than assuming a single landmark/link.
describe("PortalShell", () => {
  it("F-66: renders the four bottom tabs as a labeled nav", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    expect(screen.getAllByRole("navigation", { name: "Portal" }).length).toBeGreaterThan(0);
    for (const [name, href] of [
      ["Dashboard", "/portal/dashboard"],
      ["Leads", "/portal/leads"],
      ["Activity", "/portal/activity"],
      ["Account", "/portal"],
    ] as const) {
      const links = screen.getAllByRole("link", { name });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute("href", href);
    }
  });

  it("WP-F.3: marks the Dashboard tab current on /portal/dashboard", () => {
    mockPath = "/portal/dashboard";
    renderShell();
    for (const link of screen.getAllByRole("link", { name: "Dashboard" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    for (const link of screen.getAllByRole("link", { name: "Leads" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("marks the active tab from the URL", () => {
    mockPath = "/portal/leads";
    renderShell();
    for (const link of screen.getAllByRole("link", { name: "Leads" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    for (const link of screen.getAllByRole("link", { name: "Activity" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("hides the shell chrome on the pre-auth login route", () => {
    mockPath = "/portal/login";
    renderShell();
    expect(screen.queryByRole("navigation", { name: "Portal" })).toBeNull();
    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});
