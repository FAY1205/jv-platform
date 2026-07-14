// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/leads" }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn(async () => ({ email: "ops@meridianbuyers.com", role: "partner", workspace: { name: "Meridian Buyers" } })) }));
// Stub the chrome children so the shell test doesn't pull in their own queries/effects.
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => <button aria-label="Notifications" /> }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => <button aria-label="Toggle theme" /> }));

import { PortalShell } from "@/components/PortalShell";

function renderShell(children: React.ReactNode = <main>page body</main>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{<PortalShell>{children}</PortalShell>}</QueryClientProvider>);
}

describe("WP-PW-1 PortalShell (responsive)", () => {
  // NOTE: jsdom loads no compiled Tailwind CSS, so `md:hidden`/`hidden md:flex` don't
  // hide anything — BOTH the desktop rail nav and the mobile bottom-tab nav are in the DOM
  // (and both are labelled "Portal"). Query at the screen level and assert counts >= 1
  // rather than through a single "Portal" navigation landmark.
  it("PW-02: renders a nav link for each of the four sections (rail + tabs)", () => {
    renderShell();
    for (const label of ["Dashboard", "Leads", "Activity", "Account"]) {
      expect(screen.getAllByRole("link", { name: new RegExp(label, "i") }).length).toBeGreaterThan(0);
    }
  });

  it("PW-02: shows the route-derived page title in a heading", () => {
    renderShell();
    // /portal/leads → "Leads" title in the desktop top bar
    expect(screen.getByRole("heading", { name: "Leads" })).toBeTruthy();
  });

  it("PW-02: marks the active section with aria-current", () => {
    renderShell();
    const active = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(active.some((a) => /leads/i.test(a.textContent ?? ""))).toBe(true);
  });

  it("PW-02: renders the page children exactly once (no duplicate main)", () => {
    renderShell(<main>page body</main>);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByText("page body")).toBeTruthy();
  });
});
