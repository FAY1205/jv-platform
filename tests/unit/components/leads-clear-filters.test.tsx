// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-N3B / C-54 — the SITE wiring the primitive's own suite cannot prove: a leads list that
// filters to zero offers a way out, and taking it resets the whole bar. The interesting part is
// that the button lives in the TABLE while the filter state lives in the BAR: it works by
// pushing EMPTY down the same SV-04 apply channel a saved view uses, so this is the test that
// would fail if someone reached for a second, private reset that skipped the bar (leaving the
// search box still full of text while the request went out empty), or if the button rendered on
// a genuinely empty list where it would do nothing.
const { apiGet, apiMutate } = vi.hoisted(() => ({ apiGet: vi.fn(), apiMutate: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet, apiMutate, ApiError: class ApiError extends Error {} }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicStub(props: { refId?: string; filters?: unknown }) {
      if (props.filters) return <div data-testid="board">board</div>;
      if (props.refId) return <div data-testid="lead-dialog">{props.refId}</div>;
      return null;
    },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

import { LeadsView } from "@/app/(admin)/leads/leads-view";
import { setPreferences } from "@/lib/preferences";
import { DEFAULT_STATUS_FILTERS } from "@/modules/leads/schema";

const PARTNER_ID = "11111111-2222-3333-4444-555555555555";

/** Every /api/leads list URL the table has requested, in order. */
const leadsCalls = () => apiGet.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/leads?"));
const lastParams = () => {
  const url = leadsCalls().at(-1)!;
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
};

beforeEach(() => {
  window.localStorage.clear();
  setPreferences({ leadsView: "list" }); // the store is module-level; reset it per test
  apiGet.mockReset();
  apiMutate.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/saved-views")) return { views: [] };
    if (url.startsWith("/api/tags")) return { tags: [] };
    if (url.includes("/api/admin/partners")) return { partners: [{ id: PARTNER_ID, refId: "JV-101", name: "Desert", color: "#111" }] };
    if (url.includes("/api/leads/sources")) return { sources: ["Lead Source 1"] };
    if (url.includes("/api/leads/counts")) return { total: 0, unmatched: 0 };
    // The whole point of this suite: the list is ALWAYS empty, so the only variable is whether
    // the page thinks filters are responsible for that.
    if (url.startsWith("/api/leads?")) return { leads: [], page: 1, pageSize: 25, total: 0 };
    return { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderLeads() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LeadsView initialQ="" />
    </QueryClientProvider>,
  );
}

const clearFiltersButton = () => screen.queryByRole("button", { name: "Clear filters" });

describe("N3B-03/C-54: the filtered-to-zero leads list offers a way out", () => {
  it("N3B-03/C-54: leads filtered-empty offers Clear filters and resets the bar", async () => {
    const user = userEvent.setup();
    renderLeads();

    // Zero leads and NO filters: nothing to clear, so no button — an untouched install never
    // shows a control that would do nothing.
    expect(await screen.findByText("No leads found")).toBeInTheDocument();
    expect(clearFiltersButton()).toBeNull();

    // Now filter to zero, from two different controls so the reset has to clear more than text.
    const search = await screen.findByRole("textbox", { name: /search leads/i });
    await user.type(search, "cactus");
    await user.click(screen.getByRole("button", { name: /^hot$/i }));
    await waitFor(() => {
      const params = lastParams();
      expect(params.get("q")).toBe("cactus");
      expect(params.get("hot")).toBe("1");
    });

    // The empty state now carries the way out.
    const clear = await screen.findByRole("button", { name: "Clear filters" });
    await user.click(clear);

    // The REQUEST goes back to the default filter set…
    await waitFor(() => {
      const params = lastParams();
      expect(params.get("q")).toBe("");
      expect(params.get("hot")).toBeNull();
      expect(params.get("statuses")).toBe(DEFAULT_STATUS_FILTERS.join(","));
      expect(params.get("partnerId")).toBeNull();
      expect(params.get("state")).toBeNull();
      expect(params.get("source")).toBeNull();
      expect(params.get("tags")).toBeNull();
      expect(params.get("dateFrom")).toBeNull();
    });
    // …and so does the BAR itself — proof the reset went through the filter bar's own state
    // rather than a second, private path that would leave the visible controls stale.
    expect(screen.getByRole("textbox", { name: /search leads/i })).toHaveValue("");
    expect(screen.getByRole("button", { name: /^hot$/i })).toHaveAttribute("aria-pressed", "false");
    // Nothing left to clear ⇒ the button retires with the filters.
    await waitFor(() => expect(clearFiltersButton()).toBeNull());
  });

  it("N3B-03/C-54: the empty-state button and the bar's own Clear all are the same reset", async () => {
    const user = userEvent.setup();
    renderLeads();

    const search = await screen.findByRole("textbox", { name: /search leads/i });
    await user.type(search, "cactus");
    await user.click(screen.getByRole("button", { name: /^hot$/i }));
    await waitFor(() => expect(lastParams().get("hot")).toBe("1"));

    // The bar's "Clear all" — the pre-existing path — settles on some request.
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(lastParams().get("q")).toBe(""));
    const viaClearAll = leadsCalls().at(-1)!;

    // Re-filter, then take the empty state's way out instead.
    await user.type(screen.getByRole("textbox", { name: /search leads/i }), "cactus");
    await user.click(screen.getByRole("button", { name: /^hot$/i }));
    await waitFor(() => expect(lastParams().get("hot")).toBe("1"));
    await user.click(await screen.findByRole("button", { name: "Clear filters" }));

    // Byte-identical request: one reset, reached two ways (the WP's "do NOT invent a second
    // reset" — this is what would fail if the two implementations drifted).
    await waitFor(() => expect(leadsCalls().at(-1)).toBe(viaClearAll));
  });
});
