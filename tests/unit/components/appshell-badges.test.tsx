// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// D2 (SC 4.1.2): the admin rail badge counts compose into the LINK's accessible name
// ("Leads, 412" / "Unmatched, 3"), the badge itself is aria-hidden — mirrors the
// portal-shell twin tests (same URL-routed apiGet mock pattern).

let counts = { leads: 0, unmatched: 0 };
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({
  default: () => {
    return function Stub() {
      return null;
    };
  },
}));
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) =>
    url.includes("/api/leads/unmatched/count")
      ? { count: counts.unmatched }
      : url.includes("/api/leads/count")
        ? { count: counts.leads }
        : { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 }),
}));

import { AppShell } from "@/components/AppShell";

afterEach(() => {
  counts = { leads: 0, unmatched: 0 };
});

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell>
        <div>page</div>
      </AppShell>
    </QueryClientProvider>,
  );
}

describe("D2: AppShell nav badge accessible names (SC 4.1.2)", () => {
  it("D2: badge counts compose into the link names — 'Leads, 412' / 'Unmatched, 3'", async () => {
    counts = { leads: 412, unmatched: 3 };
    renderShell();
    // The mobile drawer is closed by default, so exactly one rail link each.
    expect(await screen.findByRole("link", { name: "Leads, 412" })).toHaveAttribute("href", "/leads");
    expect(await screen.findByRole("link", { name: "Unmatched, 3" })).toHaveAttribute("href", "/unmatched");
  });

  it("D2: zero counts leave the plain link names (no badge, no suffixed name)", async () => {
    renderShell();
    expect(await screen.findByRole("link", { name: "Leads" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unmatched" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Leads, \d/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Unmatched, \d/ })).toBeNull();
  });
});
