// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-UX-4 / MAP-06 + MAP-07 (ADR-0050). The Unmatched gap map's half of the PRN-14 fix lives
// on the PAGE: it formats one on-map label per gap state from the stats it already holds, and
// anchors the legend ramp to that same served range. Neither number is re-derived anywhere
// else (PRN-15), which is exactly what these tests pin.

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiGet,
  apiMutate: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

// The admin shell (nav, profile menu, notifications, global search, preferences) is not what
// this suite is about, and mounting it drags in a dozen unrelated queries. Swap it for the
// one thing the page body genuinely needs from it: the ToastProvider (ADR-0030). The header
// title goes through usePageHeader, which is a documented no-op outside its provider.
vi.mock("@/components", async (orig) => {
  const actual = await orig<typeof import("@/components")>();
  return {
    ...actual,
    AppShell: ({ children }: { children: React.ReactNode }) => <actual.ToastProvider>{children}</actual.ToastProvider>,
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/unmatched",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// next/dynamic(..., {ssr:false}) paints nothing on first render in jsdom. Swap in a stub that
// records the props the page hands the map, so `stateLabels` is observable.
const { mapProps } = vi.hoisted(() => ({ mapProps: [] as Record<string, unknown>[] }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicStub(props: Record<string, unknown>) {
      // Only the map is given `states`; the LeadDialog stub is not.
      if (props.states) mapProps.push(props);
      return <div data-testid="map-stub" />;
    },
}));

import UnmatchedPage from "@/app/(admin)/unmatched/page";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as unknown as typeof requestAnimationFrame;
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
}

const EMPTY_LEADS = { leads: [], page: 1, pageSize: 20, total: 0 };

/** Route every apiGet the page (and the shell around it) makes. */
function stubApi(byState: { state: string; count: number }[]) {
  const total = byState.reduce((s, g) => s + g.count, 0);
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/leads/unmatched/backfill")) return { matches: [] };
    if (url.startsWith("/api/leads/unmatched")) return { total, byState };
    if (url.startsWith("/api/leads")) return EMPTY_LEADS;
    if (url.startsWith("/api/admin/partners")) return { partners: [] };
    return {};
  });
}

async function renderPage(byState: { state: string; count: number }[]) {
  stubApi(byState);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <UnmatchedPage />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("map-stub")).toBeTruthy());
  return utils;
}

/** The legend is the one role="img" the page renders outside the (stubbed) map. */
const legend = () => screen.getByRole("img", { name: /shading ranges|every state with gaps/i });

beforeEach(() => {
  mapProps.length = 0;
  apiGet.mockReset();
});

describe("Unmatched gap map — MAP-06 / MAP-07", () => {
  const SPREAD = [
    { state: "NE", count: 7 },
    { state: "MT", count: 5 },
    { state: "NM", count: 2 },
    { state: "WY", count: 1 },
    { state: "—", count: 3 },
  ];

  it("MAP-07 / PRN-14: the legend anchors the ramp to the real min and max", async () => {
    await renderPage(SPREAD);
    const el = legend();
    expect(el.textContent).toContain("1"); // min — the lightest swatch
    expect(el.textContent).toContain("7"); // max — the darkest
    expect(el.textContent).toContain("Fewer");
    expect(el.textContent).toContain("More");
  });

  it("MAP-07: the legend exposes the range as its accessible name and is no longer aria-hidden", async () => {
    await renderPage(SPREAD);
    const el = legend();
    expect(el.getAttribute("aria-label")).toBe(
      "Shading ranges from 1 unmatched lead (lightest) to 7 (darkest) per state",
    );
    expect(el.getAttribute("aria-hidden")).toBeNull();
  });

  it("MAP-07: min === max renders the single-value form, not a range", async () => {
    await renderPage([
      { state: "NE", count: 4 },
      { state: "WY", count: 4 },
    ]);
    const el = legend();
    expect(el.getAttribute("aria-label")).toBe("Every state with gaps has 4 unmatched leads");
    expect(el.textContent).toContain("4 per state");
    expect(el.textContent).not.toContain("Fewer");
  });

  it('MAP-06 / PRN-15: one label per gap state, formatted "{state} · {count}", with "—" excluded', async () => {
    await renderPage(SPREAD);
    const labels = mapProps.at(-1)!.stateLabels as { code: string; text: string }[];

    expect(labels).toHaveLength(4); // 5 buckets minus the no-state "—"
    expect(labels.map((l) => l.code)).not.toContain("—");
    expect(labels).toEqual([
      { code: "NE", text: "NE · 7" },
      { code: "MT", text: "MT · 5" },
      { code: "NM", text: "NM · 2" },
      { code: "WY", text: "WY · 1" },
    ]);
  });

  it("MAP-06: the map's accessible name says the states are labeled with code and count", async () => {
    await renderPage(SPREAD);
    expect(mapProps.at(-1)!.ariaLabel).toBe(
      "United States map shading states by their number of unmatched leads; each shaded state is labeled with its code and count",
    );
  });
});
