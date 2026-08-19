// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// D2 (SC 4.1.2): the admin rail badge counts compose into the LINK's accessible name
// ("Leads, 412" / "Unmatched, 3"), the badge itself is aria-hidden — mirrors the
// portal-shell twin tests (same URL-routed apiGet mock pattern).

let counts = { leads: 0, active: 0, unmatched: 0 };
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
const urls: string[] = [];
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    urls.push(url);
    return url.includes("/api/leads/counts")
      ? { total: counts.leads, active: counts.active, unmatched: counts.unmatched }
      : { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
  }),
}));

import { AppShell } from "@/components/AppShell";

afterEach(() => {
  counts = { leads: 0, active: 0, unmatched: 0 };
  urls.length = 0;
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
  it("D2: badge counts compose into the link names — 'Leads, 389' / 'Unmatched, 3'", async () => {
    counts = { leads: 412, active: 389, unmatched: 3 };
    renderShell();
    // The mobile drawer is closed by default, so exactly one rail link each.
    expect(await screen.findByRole("link", { name: "Leads, 389" })).toHaveAttribute("href", "/leads");
    expect(await screen.findByRole("link", { name: "Unmatched, 3" })).toHaveAttribute("href", "/unmatched");
  });

  it("N3C-01/Q3: the Leads badge is the ACTIVE count, not the raw total", async () => {
    // 412 leads exist; 23 of them are MLS-removed, so the page this badge links to opens on
    // 389. A badge reading 412 over a list headed 389 is a discrepancy with no explanation
    // on screen — the badge now names the set the click actually lands on.
    counts = { leads: 412, active: 389, unmatched: 3 };
    renderShell();
    await screen.findByRole("link", { name: "Leads, 389" });
    expect(screen.queryByRole("link", { name: "Leads, 412" })).toBeNull();
  });

  it("N3C-01/Q3: an all-removed workspace shows no Leads badge at all", async () => {
    counts = { leads: 12, active: 0, unmatched: 0 };
    renderShell();
    expect(await screen.findByRole("link", { name: "Leads" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Leads, \d/ })).toBeNull();
  });

  it("D2: zero counts leave the plain link names (no badge, no suffixed name)", async () => {
    renderShell();
    expect(await screen.findByRole("link", { name: "Leads" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unmatched" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Leads, \d/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Unmatched, \d/ })).toBeNull();
  });

  it("C-41d: both badges come from ONE /api/leads/counts request — the old count pair is gone", async () => {
    counts = { leads: 412, active: 389, unmatched: 3 };
    renderShell();
    await screen.findByRole("link", { name: "Leads, 389" });
    await screen.findByRole("link", { name: "Unmatched, 3" });
    const countUrls = urls.filter((u) => u.includes("count"));
    expect(countUrls).toEqual(["/api/leads/counts"]);
  });
});
