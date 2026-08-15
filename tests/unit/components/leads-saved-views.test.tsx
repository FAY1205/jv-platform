// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-SV-1 / SV-04 — the round trip the menu's own suite cannot prove: applying a saved view
// REPLACES the leads page's whole filter state, all the way down to the request the table
// makes. The filter bar owns uncommitted input state (search text, pills, comboboxes), so
// "apply" is only real if it reaches through that layer — this is the test that would fail if
// a view were merged into the current filters instead of replacing them, or if a control the
// board mode HIDES kept its pre-apply value.
const { apiGet, apiMutate } = vi.hoisted(() => ({ apiGet: vi.fn(), apiMutate: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet, apiMutate, ApiError: class ApiError extends Error {} }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/leads",
}));

// One stub for every next/dynamic import on this page: the board (takes `filters`) and the
// lead dialog (takes `refId`).
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
import { EMPTY_SAVED_VIEW_FILTERS } from "@/modules/saved-views/schema";

const PARTNER_ID = "11111111-2222-3333-4444-555555555555";
const TAG_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const GONE_TAG_ID = "99999999-8888-7777-6666-555555555555";

const LIST_VIEW = {
  id: "v1",
  name: "Hot in AZ",
  filters: {
    ...EMPTY_SAVED_VIEW_FILTERS,
    q: "cactus",
    state: "AZ",
    partnerId: PARTNER_ID,
    source: "Lead Source 1",
    statuses: ["New", "Contacted"],
    hot: true,
    tags: [TAG_ID],
    dateFrom: "2026-01-01",
    dateTo: "2026-02-01",
  },
  updatedAt: "2026-08-15T10:00:00.000Z",
};
const BOARD_VIEW = {
  id: "v2",
  name: "Board book",
  filters: { ...EMPTY_SAVED_VIEW_FILTERS, viewMode: "board" as const, hot: true },
  updatedAt: "2026-08-14T10:00:00.000Z",
};
const STALE_TAG_VIEW = {
  id: "v3",
  name: "Stale tag",
  filters: { ...EMPTY_SAVED_VIEW_FILTERS, tags: [GONE_TAG_ID] },
  updatedAt: "2026-08-13T10:00:00.000Z",
};

/** Every /api/leads URL the table has requested, in order. */
const leadsCalls = () => apiGet.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/leads?"));

beforeEach(() => {
  window.localStorage.clear();
  setPreferences({ leadsView: "list" }); // the store is module-level; reset it per test
  apiGet.mockReset();
  apiMutate.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/saved-views")) return { views: [LIST_VIEW, BOARD_VIEW, STALE_TAG_VIEW] };
    if (url.startsWith("/api/tags")) return { tags: [{ id: TAG_ID, name: "Probate", color: "teal", leadCount: 3 }] };
    if (url.includes("/api/admin/partners")) return { partners: [{ id: PARTNER_ID, refId: "JV-101", name: "Desert", color: "#111" }] };
    if (url.includes("/api/leads/sources")) return { sources: ["Lead Source 1"] };
    if (url.includes("/api/leads/unmatched/count")) return { count: 0 };
    if (url.includes("/api/leads/count")) return { count: 0 };
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

async function applyView(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("button", { name: /saved views/i }));
  await user.click(await screen.findByRole("menuitem", { name }));
}

describe("SV-04: applying a saved view replaces the leads page's filter state", () => {
  it("SV-04: every filter in the view reaches the list request — through the filter bar", async () => {
    const user = userEvent.setup();
    renderLeads();
    await waitFor(() => expect(leadsCalls().length).toBeGreaterThan(0));

    await applyView(user, "Hot in AZ");

    await waitFor(() => {
      const url = leadsCalls().at(-1)!;
      const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
      expect(params.get("q")).toBe("cactus");
      expect(params.get("state")).toBe("AZ");
      expect(params.get("partnerId")).toBe(PARTNER_ID);
      expect(params.get("source")).toBe("Lead Source 1");
      expect(params.get("statuses")).toBe("New,Contacted");
      expect(params.get("hot")).toBe("1");
      expect(params.get("tags")).toBe(TAG_ID);
      expect(params.get("dateFrom")).toBe("2026-01-01");
      expect(params.get("dateTo")).toBe("2026-02-01");
    });
    // The search box shows the view's text — the bar was re-seeded, not bypassed.
    expect(screen.getByRole("textbox", { name: /search leads/i })).toHaveValue("cactus");
  });

  it("SV-04: applying REPLACES — filters set before the apply are gone, not merged", async () => {
    const user = userEvent.setup();
    renderLeads();
    await user.type(await screen.findByRole("textbox", { name: /search leads/i }), "typed by hand");
    await user.click(await screen.findByRole("button", { name: "Dead" })); // turn a status pill OFF
    await waitFor(() => {
      const url = leadsCalls().at(-1)!;
      expect(url).toContain("q=typed+by+hand");
      expect(url).not.toContain("Dead");
    });

    // A view with no search text and the default status selection.
    await applyView(user, "Stale tag");

    await waitFor(() => {
      const url = leadsCalls().at(-1)!;
      const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
      expect(params.get("q")).toBe("");
      expect(params.get("statuses")).toContain("Dead"); // the hand-made change is GONE
      expect(params.get("tags")).toBe(GONE_TAG_ID);
    });
  });

  it("SV-04: the view's list/board MODE is part of what is applied", async () => {
    const user = userEvent.setup();
    renderLeads();
    expect(screen.queryByTestId("board")).toBeNull();

    await applyView(user, "Board book");
    expect(await screen.findByTestId("board")).toBeInTheDocument();

    // …and applying a LIST view brings the table back.
    await applyView(user, "Hot in AZ");
    await waitFor(() => expect(screen.queryByTestId("board")).toBeNull());
  });

  it("SV-05: a view carrying a DELETED tag degrades — the filter is visible and removable", async () => {
    const user = userEvent.setup();
    renderLeads();
    await applyView(user, "Stale tag");

    // The id is uuid-shaped, so it still reaches the query (and matches nothing) — which is why
    // it must not be invisible: a neutral, removable chip says why the page is empty.
    await waitFor(() => expect(leadsCalls().at(-1)).toContain(`tags=${GONE_TAG_ID}`));
    const chip = await screen.findByRole("button", { name: "Remove tag Deleted tag" });

    await user.click(chip);
    await waitFor(() => expect(leadsCalls().at(-1)).not.toContain("tags="));
  });

  it("SV-04: the trigger names the applied view and flags divergence once the page is edited", async () => {
    const user = userEvent.setup();
    renderLeads();
    await applyView(user, "Hot in AZ");
    expect(await screen.findByRole("button", { name: /saved views — hot in az$/i })).toBeInTheDocument();

    // Any real filter change diverges — here the Hot pill, which the view had ON.
    await user.click(screen.getByRole("button", { name: /^hot$/i }));
    expect(await screen.findByRole("button", { name: /saved views — hot in az, modified/i })).toBeInTheDocument();
  });
});
