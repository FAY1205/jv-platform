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

const STATS = {
  range: "30d",
  leads: 42,
  contacted: 17,
  closed: 9,
  untouched: 5,
  leadsDelta: 5,
  untouchedDelta: -2,
  contactedDelta: 0,
  closedDelta: 3,
};
// WP-PW-2b Task 2: "all" range — analytics returns null deltas (no prior window to compare).
const STATS_ALL_TIME = {
  range: "all",
  leads: 42,
  contacted: 17,
  closed: 9,
  untouched: 5,
  leadsDelta: null,
  untouchedDelta: null,
  contactedDelta: null,
  closedDelta: null,
};
const TERRITORY = {
  states: [],
  ownStateCount: 3,
  partner: { name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
};
// C-41a: the preview reads the SAME payload the leads list does, so the fixture carries the
// full PartnerLeadRow shape (seller + score fields included), not just the columns drawn here.
const LEADS_PAGE = {
  leads: [
    { refId: "JV-1001", sellerFirst: "Ana", sellerLast: "Ruiz", address: "12 Elm St", city: "Austin", state: "TX", zip: "78701", receivedAt: "2026-07-10T00:00:00.000Z", status: "New", scoreTotal: null, scoreGroup: null },
    { refId: "JV-1002", sellerFirst: "Bo", sellerLast: "Kim", address: "88 Oak Ave", city: "Dallas", state: "TX", zip: "75201", receivedAt: "2026-07-09T00:00:00.000Z", status: "Contacted", scoreTotal: null, scoreGroup: null },
  ],
  page: 1,
  pageSize: 20,
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
// C-41a: it DOES now decide whether the recent-leads preview fetches at all (the section is
// `hidden lg:block`, so on a phone it was a request for a table nobody could see). The stub
// therefore defaults to the DESKTOP breakpoint — the viewport the preview exists for — and
// the C-41a describe below flips it to prove the phone case.
let matchesMedia = true;
function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matchesMedia,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
beforeEach(() => {
  matchesMedia = true;
  stubMatchMedia();
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

  describe("WP-PW-2b Task 2: prior-window deltas on the KPI tiles", () => {
    afterEach(() => {
      vi.mocked(apiGet).mockImplementation(async (url: string) => {
        if (url.startsWith("/api/portal/dashboard")) return STATS;
        if (url.startsWith("/api/portal/territory")) return TERRITORY;
        if (url.startsWith("/api/portal/leads")) return LEADS_PAGE;
        throw new Error(`unexpected apiGet url in test: ${url}`);
      });
    });

    it("PW2B-07: renders 'vs prior' delta text on KPI tiles (both breakpoints) when deltas are numeric", async () => {
      renderDashboard();
      // 4 KPI tiles x 2 breakpoints (mobile dense + desktop) = up to 8 instances in jsdom
      // (no compiled CSS, so both `lg:hidden` and `hidden lg:grid` blocks are in the DOM).
      const deltas = await screen.findAllByText(/vs prior/i);
      expect(deltas.length).toBeGreaterThan(0);
    });

    it("PW2B-07: renders 'all time' on KPI tiles (both breakpoints) when range=all and deltas are null", async () => {
      vi.mocked(apiGet).mockImplementation(async (url: string) => {
        if (url.startsWith("/api/portal/dashboard")) return STATS_ALL_TIME;
        if (url.startsWith("/api/portal/territory")) return TERRITORY;
        if (url.startsWith("/api/portal/leads")) return LEADS_PAGE;
        throw new Error(`unexpected apiGet url in test: ${url}`);
      });
      renderDashboard();
      const allTime = await screen.findAllByText(/all time/i);
      expect(allTime.length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/vs prior/i).length).toBe(0);
    });
  });

  // C-41a: the preview used to claim it shared the leads page's cache with a key
  // (["portal-leads", 1]) and a url (?page=1) that matched NEITHER leads list — so the claim
  // was false and a dashboard → leads navigation always refetched. It now asks the one
  // canonical question, and only on the breakpoint that renders it.
  describe("C-41a: the recent-leads preview shares one cache entry, and skips the phone", () => {
    it("C-41a: requests the canonical portal-leads url the leads list opens on", async () => {
      vi.mocked(apiGet).mockClear();
      renderDashboard();
      await screen.findByText("JV-1001");
      const leadUrls = vi.mocked(apiGet).mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith("/api/portal/leads"));
      expect(leadUrls).toEqual(["/api/portal/leads?page=1&pageSize=20&sort=received&dir=desc"]);
    });

    it("C-41a: on a phone the desktop-only preview does not fetch leads at all", async () => {
      matchesMedia = false;
      stubMatchMedia();
      vi.mocked(apiGet).mockClear();
      renderDashboard();
      // The dashboard still loads its own (breakpoint-independent) data...
      expect((await screen.findAllByText("42")).length).toBeGreaterThan(0);
      // ...but nothing asked for a leads page.
      const leadUrls = vi.mocked(apiGet).mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith("/api/portal/leads"));
      expect(leadUrls).toEqual([]);
    });
  });
});
