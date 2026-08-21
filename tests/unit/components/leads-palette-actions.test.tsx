// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-N6 / N6-72..73 — the LEADS side of the Ctrl-K actions. The palette's own suite
// (global-search.test.tsx) proves it dispatches; this one proves the page listens, and that
// each event lands in the state a click would have produced. They meet at the event contract
// in lib/leads-actions, which both import rather than restate.
//
// The `?view=` leg is the same action arriving from a page where this list was not mounted to
// receive an event: the id is matched against the roster the client already fetched, so an id
// that isn't in it degrades to the default page rather than to an error.
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
import { requestLeadsApplyView, requestLeadsClearFilters, requestLeadsOpenColumns } from "@/lib/leads-actions";
import { EMPTY_SAVED_VIEW_FILTERS } from "@/modules/saved-views/schema";

const VIEW_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "99999999-8888-7777-6666-555555555555";

const HOT_AZ = { ...EMPTY_SAVED_VIEW_FILTERS, q: "cactus", state: "AZ", hot: true };
const VIEW = { id: VIEW_ID, name: "Hot in AZ", filters: HOT_AZ, updatedAt: "2026-08-15T10:00:00.000Z" };

/** Every /api/leads list URL the table has requested, in order. */
const leadsCalls = () => apiGet.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/leads?"));
const lastParams = () => {
  const url = leadsCalls().at(-1)!;
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
};

beforeEach(() => {
  window.localStorage.clear();
  setPreferences({ leadsView: "list", leadsColumns: { hidden: [] } });
  apiGet.mockReset();
  apiMutate.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/saved-views")) return { views: [VIEW] };
    if (url.startsWith("/api/tags")) return { tags: [], total: 0, limit: 50 };
    if (url.includes("/api/admin/partners")) return { partners: [] };
    if (url.includes("/api/leads/sources")) return { sources: [] };
    if (url.includes("/api/leads/counts")) return { total: 0, unmatched: 0 };
    if (url.startsWith("/api/leads?")) return { leads: [], page: 1, pageSize: 25, total: 0 };
    return { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderLeads(props: { initialViewId?: string | null } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LeadsView initialQ="" {...props} />
    </QueryClientProvider>,
  );
}

describe("N6-72: the palette's leads events", () => {
  it("N6-72: jv:leads-apply-view replaces the filter state, through the bar", async () => {
    renderLeads();
    await waitFor(() => expect(leadsCalls().length).toBeGreaterThan(0));

    await act(async () => {
      requestLeadsApplyView({ id: VIEW_ID, name: "Hot in AZ", filters: HOT_AZ });
    });

    await waitFor(() => {
      const p = lastParams();
      expect(p.get("q")).toBe("cactus");
      expect(p.get("state")).toBe("AZ");
      expect(p.get("hot")).toBe("1");
    });
    // The bar was RE-SEEDED, not bypassed — the same one-way channel a menu click uses.
    expect(screen.getByRole("textbox", { name: /search leads/i })).toHaveValue("cactus");
  });

  it("N6-72: jv:leads-clear-filters returns the page to its opening state", async () => {
    const user = userEvent.setup();
    renderLeads();
    await user.type(await screen.findByRole("textbox", { name: /search leads/i }), "typed by hand");
    await waitFor(() => expect(lastParams().get("q")).toBe("typed by hand"));

    await act(async () => {
      requestLeadsClearFilters();
    });

    await waitFor(() => expect(lastParams().get("q")).toBe(""));
    expect(screen.getByRole("textbox", { name: /search leads/i })).toHaveValue("");
  });

  it("N6-73: jv:leads-open-columns raises the Columns menu", async () => {
    renderLeads();
    expect(await screen.findByRole("button", { name: /choose columns/i })).toBeInTheDocument();
    // Uncontrolled-by-default is preserved: nothing is open until asked.
    expect(screen.queryByRole("menuitemcheckbox", { name: /seller/i })).toBeNull();

    await act(async () => {
      requestLeadsOpenColumns();
    });

    expect(await screen.findByRole("menuitemcheckbox", { name: /seller/i })).toBeInTheDocument();
  });

  it("N6-72: the listeners are torn down with the page — no write, no leak", async () => {
    const { unmount } = renderLeads();
    await waitFor(() => expect(leadsCalls().length).toBeGreaterThan(0));
    unmount();

    // Firing into a page that has gone must not throw or re-render anything.
    await act(async () => {
      requestLeadsApplyView({ id: VIEW_ID, name: "Hot in AZ", filters: HOT_AZ });
      requestLeadsClearFilters();
      requestLeadsOpenColumns();
    });
    // Nothing in this whole flow writes (the palette is navigate-and-view only).
    expect(apiMutate).not.toHaveBeenCalled();
  });
});

describe("N6-72: ?view= seeding", () => {
  it("N6-72: ?view=<id> applies that saved view once the roster lands", async () => {
    renderLeads({ initialViewId: VIEW_ID });

    await waitFor(() => {
      const p = lastParams();
      expect(p.get("q")).toBe("cactus");
      expect(p.get("state")).toBe("AZ");
      expect(p.get("hot")).toBe("1");
    });
    expect(screen.getByRole("textbox", { name: /search leads/i })).toHaveValue("cactus");
  });

  it("N6-72: an id outside the caller's OWN roster opens the default AND says so", async () => {
    renderLeads({ initialViewId: OTHER_ID });

    // The roster is the user's own (server-scoped), so a foreign or deleted id matches nothing.
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/api/saved-views"));
    await waitFor(() => expect(leadsCalls().length).toBeGreaterThan(0));
    // The page opens at its DEFAULT…
    const p = lastParams();
    expect(p.get("q")).toBe("");
    expect(p.get("state")).toBeNull();
    expect(p.get("hot")).toBeNull();
    // …and the id never reached a query: the only place it appears is the roster match.
    expect(leadsCalls().every((u) => !u.includes(OTHER_ID))).toBe(true);
    // audit-ux-flows: NOT silent. A link that quietly does nothing is indistinguishable from
    // one that worked on a view which happens to look like the default (draft UXQ-09).
    await waitFor(() =>
      expect(screen.getByTestId("toast-stack")).toHaveTextContent(/that saved view no longer exists/i),
    );
  });

  it("N6-72: a roster read that FAILS says the link couldn't be honoured", async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/saved-views")) throw new Error("views are down");
      if (url.startsWith("/api/tags")) return { tags: [], total: 0, limit: 50 };
      if (url.includes("/api/admin/partners")) return { partners: [] };
      if (url.includes("/api/leads/sources")) return { sources: [] };
      if (url.includes("/api/leads/counts")) return { total: 0, unmatched: 0 };
      if (url.startsWith("/api/leads?")) return { leads: [], page: 1, pageSize: 25, total: 0 };
      return { email: "admin@dev.test", role: "admin", workspace: { name: "W" }, notifications: [], unread: 0 };
    });
    renderLeads({ initialViewId: VIEW_ID });

    await waitFor(() =>
      expect(screen.getByTestId("toast-stack")).toHaveTextContent(/couldn't load your saved views/i),
    );
    // The page is still usable at its default — the failure is reported, not fatal.
    await waitFor(() => expect(leadsCalls().length).toBeGreaterThan(0));
    expect(lastParams().get("q")).toBe("");
  });

  it("N6-72: a hand edit after the seed is not undone by a re-render", async () => {
    const user = userEvent.setup();
    renderLeads({ initialViewId: VIEW_ID });
    await waitFor(() => expect(lastParams().get("q")).toBe("cactus"));

    await user.clear(screen.getByRole("textbox", { name: /search leads/i }));
    await waitFor(() => expect(lastParams().get("q")).toBe(""));
    // The seed is once-per-id: the view does not reapply itself over the operator's edit.
    await new Promise((r) => setTimeout(r, 400));
    expect(lastParams().get("q")).toBe("");
  });
});
