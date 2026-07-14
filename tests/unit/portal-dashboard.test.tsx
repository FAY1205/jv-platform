// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-PW-2 Task 2: the desktop hero + recent-leads restructure of the partner Dashboard.
// next/dynamic(..., {ssr:false}) renders nothing on first paint in real usage; stub it to
// render the lazily-imported module synchronously so the map region has content in jsdom
// (pattern from tests/unit/components/appshell-assistant.test.tsx).
vi.mock("next/dynamic", () => ({
  default: () => {
    return function MapStub() {
      return <div data-testid="map-stub" />;
    };
  },
}));

const STATS = { range: "30d", leads: 42, contacted: 17, closed: 9, untouched: 5 };
const TERRITORY = {
  states: [],
  ownStateCount: 3,
  partner: { name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
};
const LEADS_PAGE = {
  leads: [
    { refId: "JV-1001", address: "12 Elm St", city: "Austin", state: "TX", zip: "78701", receivedAt: "2026-07-10T00:00:00.000Z", status: "New" },
    { refId: "JV-1002", address: "88 Oak Ave", city: "Dallas", state: "TX", zip: "75201", receivedAt: "2026-07-09T00:00:00.000Z", status: "Contacted" },
  ],
  page: 1,
  pageSize: 50,
  total: 2,
};

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.startsWith("/api/portal/dashboard")) return STATS;
    if (url.startsWith("/api/portal/territory")) return TERRITORY;
    if (url.startsWith("/api/portal/leads")) return LEADS_PAGE;
    throw new Error(`unexpected apiGet url in test: ${url}`);
  }),
}));

import { apiGet } from "@/lib/api";
import { PortalDashboard } from "@/app/portal/dashboard/portal-dashboard";

// WP-PW-2 final fix: PortalDashboard now calls useIsDesktop() (src/lib/use-media-query.ts,
// window.matchMedia + useSyncExternalStore), which jsdom does not implement by default.
// Stub it so the hook resolves to a defined value instead of throwing; the mobile/desktop
// KPI markup itself is still CSS-only (both stay in the DOM per the note below), so which
// boolean this returns doesn't affect the existing KPI/headline assertions — only which of
// the two map sections actually mounts the (stubbed) CountyCoverageMap.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalDashboard />
    </QueryClientProvider>,
  );
}

describe("WP-PW-2 PortalDashboard (desktop hero + recent-leads)", () => {
  // NOTE: jsdom loads no compiled Tailwind CSS, so the `lg:hidden` mobile block and the
  // `hidden lg:grid` desktop hero are BOTH present in the DOM at once (same pattern as
  // tests/unit/portal-shell.test.tsx) — the KPI headline/values render twice. Query with
  // getAllBy* and assert length >= 1 rather than a single match.
  it("PW2-02: renders the four KPI values from portal-dashboard stats", async () => {
    renderDashboard();
    expect((await screen.findAllByText("42")).length).toBeGreaterThan(0); // Leads
    expect(screen.getAllByText("5").length).toBeGreaterThan(0); // New (untouched)
    expect(screen.getAllByText("17").length).toBeGreaterThan(0); // Contacted
    expect(screen.getAllByText("9").length).toBeGreaterThan(0); // Closed
  });

  it("PW2-02: renders the territory-scoped headline", async () => {
    renderDashboard();
    // ownStateCount (3) renders both in the headline ("...across your 3-state territory")
    // and beside the partner tag beneath the map ("...your territory · 3 states"); wait for
    // the territory query (not just the always-present "Recent leads" heading) to resolve.
    expect((await screen.findAllByText(/3 states?/i)).length).toBeGreaterThan(0);
  });

  it("PW2-02: renders the recent-leads table with mocked lead refs", async () => {
    renderDashboard();
    expect(await screen.findByText("JV-1001")).toBeTruthy();
    expect(await screen.findByText("JV-1002")).toBeTruthy();
    expect(screen.getByText("88 Oak Ave")).toBeTruthy();
  });

  it("PW2-02: links to the full leads list", async () => {
    renderDashboard();
    const link = await screen.findByRole("link", { name: /view all leads/i });
    expect(link.getAttribute("href")).toBe("/portal/leads");
  });

  describe("WP-PW-2 final fix 2: stats + territory degrade independently", () => {
    afterEach(() => {
      vi.mocked(apiGet).mockImplementation(async (url: string) => {
        if (url.startsWith("/api/portal/dashboard")) return STATS;
        if (url.startsWith("/api/portal/territory")) return TERRITORY;
        if (url.startsWith("/api/portal/leads")) return LEADS_PAGE;
        throw new Error(`unexpected apiGet url in test: ${url}`);
      });
    });

    it("PW2-final: a /api/portal/dashboard failure still renders the territory map", async () => {
      vi.mocked(apiGet).mockImplementation(async (url: string) => {
        if (url.startsWith("/api/portal/dashboard")) throw new Error("stats down");
        if (url.startsWith("/api/portal/territory")) return TERRITORY;
        if (url.startsWith("/api/portal/leads")) return LEADS_PAGE;
        throw new Error(`unexpected apiGet url in test: ${url}`);
      });
      renderDashboard();

      // KPI area shows the stats error...
      expect((await screen.findAllByText("Couldn't load your dashboard")).length).toBeGreaterThan(0);
      // ...but the independent territory query still resolves and its map/tag render.
      expect((await screen.findAllByText(/3 states?/i)).length).toBeGreaterThan(0);
      expect(screen.getAllByTestId("map-stub").length).toBeGreaterThan(0);
    });
  });
});
