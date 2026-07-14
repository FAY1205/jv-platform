// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal/login" }));
vi.mock("@/lib/api", () => ({ apiGet: vi.fn(async () => ({ email: "ops@meridianbuyers.com", role: "partner", workspace: { name: "Meridian Buyers" } })) }));
// Stub the chrome children so the shell test doesn't pull in their own queries/effects.
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => <button aria-label="Notifications" /> }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => <button aria-label="Toggle theme" /> }));

import { PortalShell } from "@/components/PortalShell";

// Rules-of-Hooks regression (WP-PW-1 final fix): PortalShell lives in the persistent
// src/app/portal/layout.tsx, so a bare route (login/tos) and a chrome route share the same
// component instance across navigations. All hooks must run unconditionally before the
// `bare` early return, or React throws "Rendered more hooks than during the previous
// render." This test only proves the bare-route render shape; the hook-count invariant
// itself is exercised by navigating login -> dashboard in the real app.
describe("WP-PW-1 PortalShell (bare routes)", () => {
  it("PW-03: a bare route renders only children (no shell chrome)", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PortalShell>
          <main>x</main>
        </PortalShell>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("navigation", { name: /portal/i })).toBeNull();
    expect(screen.getByText("x")).toBeTruthy();
  });
});
