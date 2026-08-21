// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// SRCH-02 — the Ctrl-K overlay: debounced server search, full keyboard operation,
// escape-safe highlighting, and the three async states.

const push = vi.fn();
// N6-71: which page is under the overlay decides whether the page-scoped actions exist, so the
// suite drives it per test rather than pinning one route.
let pathname = "/dashboard";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}));

type Payload = {
  leads: { total: number; rows: unknown[] };
  partners: { total: number; rows: unknown[] };
};
let payload: Payload;
let failWith: Error | null = null;
/** The caller's saved views (N6-71's "Apply view: …" actions). */
let views: { id: string; name: string; filters: unknown; updatedAt: string }[] = [];

const apiGet = vi.fn(async (url: string) => {
  // Deliberately BEFORE the failure switch: `failWith` targets the search endpoint, which is
  // what the error-state tests are about.
  if (url.startsWith("/api/saved-views")) return { views };
  if (failWith) throw failWith;
  const q = new URL(url, "http://localhost").searchParams.get("q") ?? "";
  return { q, ...payload };
});
// N6-72 (owner pin): `apiMutate` is the only way this app writes. It is mocked here so the
// registry test can assert that running EVERY palette action never reaches it.
const apiMutate = vi.fn(async () => ({ code: "ok" }));
vi.mock("@/lib/api", () => ({
  apiGet: (url: string) => apiGet(url),
  apiMutate: (...args: unknown[]) => apiMutate(...(args as [])),
  ApiError: class ApiError extends Error {},
}));

import { GlobalSearchOverlay, GlobalSearchTrigger } from "@/components/GlobalSearch";
import {
  LEADS_APPLY_VIEW_EVENT,
  LEADS_CLEAR_FILTERS_EVENT,
  LEADS_OPEN_COLUMNS_EVENT,
  type LeadsApplyViewDetail,
} from "@/lib/leads-actions";

const LEAD_MARCUS = {
  refId: "LD-25-01847",
  seller: "Marcus Whitfield",
  address: "4127 E Cactus Wren Dr",
  city: "Phoenix",
  state: "AZ",
  status: "Contacted",
  mlsStatus: "kept" as const,
  hot: true,
  scoreTotal: 42,
};
const LEAD_JANET = {
  refId: "LD-24-00912",
  seller: "Janet Whitfield",
  address: "9 Elm Ct",
  city: "Norfolk",
  state: "VA",
  status: "Closed",
  mlsStatus: "kept" as const,
  hot: false,
  scoreTotal: null,
};
const PARTNER = { id: "p-1", name: "Cedar Ridge", refId: "PR-004", color: "#2F6DB0", email: "ops@cedarridge.test" };

function full(): Payload {
  return { leads: { total: 2, rows: [LEAD_MARCUS, LEAD_JANET] }, partners: { total: 1, rows: [PARTNER] } };
}
function none(): Payload {
  return { leads: { total: 0, rows: [] }, partners: { total: 0, rows: [] } };
}

// Names chosen so they do NOT contain the search terms this suite types ("whitf", "zzzz", "w")
// — an action row that matched one of them would change the option counts the search tests
// assert, and hide the thing those tests are actually about.
const VIEW_HOT = { id: "v1", name: "Hot in AZ", filters: { hot: true, state: "AZ" }, updatedAt: "2026-08-15T10:00:00.000Z" };
const VIEW_PROBATE = { id: "v2", name: "Probate list", filters: { tags: ["t1"] }, updatedAt: "2026-08-14T10:00:00.000Z" };

/** Every leads-action event the palette fired, in order. */
let fired: { type: string; detail?: unknown }[] = [];
const record = (e: Event) => fired.push({ type: e.type, detail: (e as CustomEvent).detail });

beforeEach(() => {
  payload = full();
  failWith = null;
  views = [VIEW_HOT, VIEW_PROBATE];
  pathname = "/dashboard";
  fired = [];
  apiGet.mockClear();
  apiMutate.mockClear();
  push.mockClear();
  window.addEventListener(LEADS_APPLY_VIEW_EVENT, record);
  window.addEventListener(LEADS_CLEAR_FILTERS_EVENT, record);
  window.addEventListener(LEADS_OPEN_COLUMNS_EVENT, record);
});
afterEach(() => {
  window.removeEventListener(LEADS_APPLY_VIEW_EVENT, record);
  window.removeEventListener(LEADS_CLEAR_FILTERS_EVENT, record);
  window.removeEventListener(LEADS_OPEN_COLUMNS_EVENT, record);
  vi.restoreAllMocks();
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={qc}>
      <GlobalSearchTrigger />
      <GlobalSearchOverlay />
    </QueryClientProvider>,
  );
  return { user, trigger: screen.getByRole("button", { name: "Search leads and partners" }) };
}

const input = () => screen.getByRole("combobox", { name: /search name, phone, address/i });
/** Only the SEARCH endpoint's calls. The palette also reads the saved-view roster when it
 *  opens (N6-71), which is not what the debounce tests are about. */
const searchCalls = () => apiGet.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/search"));
const options = () => screen.getAllByRole("option");
const selected = () => options().find((o) => o.getAttribute("aria-selected") === "true");

describe("SRCH-02: global search overlay", () => {
  it("SRCH-02: the topbar trigger opens the overlay; Ctrl-K opens it from anywhere", async () => {
    const { user, trigger } = setup();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("SRCH-02: keystrokes are DEBOUNCED — one request for a whole word, not one per key", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "whitf");

    // Nothing has left for the server yet: the 400ms window is still open.
    expect(searchCalls()).toHaveLength(0);

    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(apiGet).toHaveBeenCalledWith("/api/search?q=whitf");
  });

  it("SRCH-02: a PADDED query still resolves — the client sends the term the server echoes", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    // A trailing space (or an over-long paste) is normalized client-side with the
    // endpoint's own rule; comparing the raw text to the normalized echo would strand
    // the overlay on a permanent skeleton (audit-tenancy F-3).
    await user.type(input(), "  whitf  ");
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/api/search?q=whitf"));
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(screen.queryByText(/type at least 2 characters/i)).toBeNull();
  });

  it("SRCH-02: Ctrl-K while the overlay is OPEN is a no-op — a half-typed query survives", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "whitf");
    await waitFor(() => expect(options()).toHaveLength(3));

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(input()).toHaveValue("whitf");
    expect(options()).toHaveLength(3);
  });

  it("SRCH-02: a query below the minimum length never reaches the server", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    // "q" also matches no action or destination label, so the hint is what remains (N6-71 gave
    // the sub-minimum state a local action list; it still says this when nothing matches).
    await user.type(input(), "q");
    expect(await screen.findByText(/type at least 2 characters/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 600));
    expect(searchCalls()).toHaveLength(0);
  });

  it("SRCH-02: ↑↓ move the cursor and WRAP; ↵ opens the lead dialog deep-link", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "whitf");
    await waitFor(() => expect(options()).toHaveLength(3));

    // Grouped: two leads then the partner, one cursor across both groups.
    expect(selected()).toHaveTextContent("LD-25-01847");
    await user.keyboard("{ArrowDown}");
    expect(selected()).toHaveTextContent("LD-24-00912");
    await user.keyboard("{ArrowDown}{ArrowDown}"); // partner, then wrap to the first lead
    expect(selected()).toHaveTextContent("LD-25-01847");
    await user.keyboard("{ArrowUp}"); // wrap backwards onto the partner
    expect(selected()).toHaveTextContent("Cedar Ridge");
    // The partner row shows the matched email, so a hit on it has a visible reason.
    expect(selected()).toHaveTextContent("ops@cedarridge.test");

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/partners/p-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("SRCH-02: ↵ on a lead row navigates to /leads?open=<ref> (the dialog deep-link)", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "whitf");
    await waitFor(() => expect(options()).toHaveLength(3));

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/leads?open=LD-25-01847");
  });

  it("SRCH-02: matched fragments render as <mark> ELEMENTS — result text is never HTML (PRN-10)", async () => {
    payload = {
      leads: { total: 1, rows: [{ ...LEAD_MARCUS, seller: "Marcus Whitfield", address: "<b>4127</b> Whitf Ave" }] },
      partners: { total: 0, rows: [] },
    };
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "whitf");
    await waitFor(() => expect(options()).toHaveLength(1));

    const row = options()[0];
    const marks = row.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].map((m) => m.textContent)).toEqual(["Whitf", "Whitf"]);
    // The angle-bracket text was injected as DATA: it is visible text, not an element.
    expect(row.querySelector("b")).toBeNull();
    expect(row.textContent).toContain("<b>4127</b>");
  });

  it("SRCH-02: Escape closes the overlay and returns focus to the trigger", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await waitFor(() => expect(input()).toHaveFocus()); // focus lands in the search field

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus()); // Radix restores to the opener
  });

  it("SRCH-02: zero matches show an explicit empty state, not a silent void", async () => {
    payload = none();
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "zzzz");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("SRCH-02: a failed search shows the shared error state with a Retry action", async () => {
    failWith = new Error("Search failed.");
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "whitf");

    expect(await screen.findByText("Couldn't run this search")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    failWith = null;
    await user.click(retry);
    await waitFor(() => expect(options()).toHaveLength(3));
  });

  // ── UXF-2.2 (Scope-E audit §2.2): the capped preview is no longer a dead end ────────
  // The heading prints the FULL total; when that exceeds the rows shown, the group closes
  // with a row that hands the query off to the Leads list (which seeds its filter from ?q=).
  describe("UXF-2.2: group overflow row", () => {
    const capped = (): Payload => ({
      leads: { total: 42, rows: [LEAD_MARCUS, LEAD_JANET] },
      partners: { total: 1, rows: [PARTNER] },
    });

    it("UXF-2.2: a capped Leads group ends with a 'View all N in Leads' option", async () => {
      payload = capped();
      const { user, trigger } = setup();
      await user.click(trigger);
      await user.type(input(), "whitf");
      // two leads + the overflow row + the partner
      await waitFor(() => expect(options()).toHaveLength(4));
      expect(options()[2]).toHaveTextContent("View all 42 in Leads");
      // It is a real listbox OPTION, not a decorative footer.
      expect(options()[2].getAttribute("role")).toBe("option");
    });

    it("UXF-2.2: the overflow row is arrow-reachable and ↵ opens /leads?q=<query> (SC 2.1.1)", async () => {
      payload = capped();
      const { user, trigger } = setup();
      await user.click(trigger);
      await user.type(input(), "whitf");
      await waitFor(() => expect(options()).toHaveLength(4));

      // Keyboard only: down past both lead rows lands on it — no pointer involved.
      await user.keyboard("{ArrowDown}{ArrowDown}");
      expect(selected()).toHaveTextContent("View all 42 in Leads");

      await user.keyboard("{Enter}");
      expect(push).toHaveBeenCalledWith("/leads?q=whitf");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("UXF-2.2: the Partners heading still sits above the FIRST partner row, past the overflow row", async () => {
      payload = capped();
      const { user, trigger } = setup();
      await user.click(trigger);
      await user.type(input(), "whitf");
      await waitFor(() => expect(options()).toHaveLength(4));

      const rows = [...screen.getByRole("listbox").children];
      const headingIdx = rows.findIndex((el) => el.textContent?.startsWith("Partners"));
      expect(headingIdx).toBeGreaterThan(-1);
      // The next element is the partner row itself — the overflow row stayed with Leads.
      expect(rows[headingIdx + 1]).toHaveTextContent("Cedar Ridge");
      expect(rows[headingIdx - 1]).toHaveTextContent("View all 42 in Leads");
    });

    it("UXF-2.2: no overflow row when the preview already shows every match", async () => {
      payload = full(); // total 2, two rows
      const { user, trigger } = setup();
      await user.click(trigger);
      await user.type(input(), "whitf");
      await waitFor(() => expect(options()).toHaveLength(3));
      expect(screen.queryByText(/view all/i)).toBeNull();
    });

    it("UXF-2.2: a capped PARTNERS group gets no row — /partners has no query-seeded list", async () => {
      payload = { leads: { total: 2, rows: [LEAD_MARCUS, LEAD_JANET] }, partners: { total: 9, rows: [PARTNER] } };
      const { user, trigger } = setup();
      await user.click(trigger);
      await user.type(input(), "whitf");
      await waitFor(() => expect(options()).toHaveLength(3));
      expect(screen.queryByText(/view all/i)).toBeNull();
    });
  });

  it("SRCH-02: reopening starts from a clean query — the previous term isn't left behind", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "whitf");
    await waitFor(() => expect(options()).toHaveLength(3));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(trigger);
    expect(input()).toHaveValue("");
    // N6-71: the empty state is now the ACTION menu (it used to be the "type 2 characters"
    // hint) — what must not survive the reopen is the previous term's RESULTS.
    expect(screen.queryByText("LD-25-01847")).toBeNull();
    expect(screen.getByText("Go to")).toBeInTheDocument();
  });
});

// ── N6-70..74: the palette's actions ─────────────────────────────────────────────────────
// The zero-query state used to be dead until the second keystroke. It is now a menu: the
// caller's saved views, the two page-scoped leads actions, and the shell's own destinations.
// Everything in it either navigates or dispatches — nothing writes (owner decision, pinned
// by the registry test at the end of this block).
describe("N6-70..74: Ctrl-K actions", () => {
  const optionLabels = () => options().map((o) => o.textContent ?? "");
  const groupHeadings = () =>
    [...screen.getByRole("listbox").children]
      .filter((el) => el.getAttribute("role") === "presentation")
      .map((el) => el.textContent ?? "");

  it("N6-71: the zero-query state lists Actions and Go to — not a dead hint", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    expect(await screen.findByText("Apply view: Hot in AZ")).toBeInTheDocument();
    expect(screen.getByText("Apply view: Probate list")).toBeInTheDocument();
    // The shell's destinations, imported rather than re-listed (N6-71).
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(groupHeadings()).toEqual(["Actions", "Go to"]);
    expect(screen.queryByText(/type at least 2 characters/i)).toBeNull();
    // Zero-query means zero server search: the actions are answered locally.
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining("/api/search"));
  });

  it("N6-71: the page-scoped actions are ABSENT off /leads", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await screen.findByText("Apply view: Hot in AZ");
    // Absence, not a disabled row: off /leads there is nothing listening for them (N6-72).
    expect(screen.queryByText("Clear filters")).toBeNull();
    expect(screen.queryByText("Open Columns")).toBeNull();
  });

  it("N6-71: on /leads the page-scoped actions appear, hinted with their scope", async () => {
    pathname = "/leads";
    const { user, trigger } = setup();
    await user.click(trigger);
    expect(await screen.findByText("Clear filters")).toBeInTheDocument();
    expect(screen.getByText("Open Columns")).toBeInTheDocument();
    // The hint says WHERE the action acts — the same row on another page would mean nothing.
    expect(screen.getAllByText("this page")).toHaveLength(2);
  });

  it("N6-70: ↵ RUNS an action and closes the palette", async () => {
    pathname = "/leads";
    const { user, trigger } = setup();
    await user.click(trigger);
    await screen.findByText("Clear filters");

    // Keyboard only — one cursor walks actions and results alike.
    await user.type(input(), "clear f");
    await waitFor(() => expect(optionLabels()).toEqual(["Clear filtersthis page"]));
    await user.keyboard("{Enter}");

    expect(fired.map((e) => e.type)).toEqual([LEADS_CLEAR_FILTERS_EVENT]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(push).not.toHaveBeenCalled();
  });

  it("N6-72: on /leads, Apply view DISPATCHES the view (no navigation)", async () => {
    pathname = "/leads";
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.click(await screen.findByText("Apply view: Hot in AZ"));

    expect(fired).toHaveLength(1);
    expect(fired[0].type).toBe(LEADS_APPLY_VIEW_EVENT);
    const detail = fired[0].detail as LeadsApplyViewDetail;
    expect(detail.id).toBe("v1");
    expect(detail.filters).toEqual(VIEW_HOT.filters);
    expect(push).not.toHaveBeenCalled();
  });

  it("N6-72: off /leads, Apply view NAVIGATES to /leads?view=<id>", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.click(await screen.findByText("Apply view: Probate list"));

    expect(push).toHaveBeenCalledWith("/leads?view=v2");
    expect(fired).toHaveLength(0); // nothing is listening off the leads page
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("N6-71: below the search minimum, typing FILTERS the actions by label", async () => {
    pathname = "/leads";
    const { user, trigger } = setup();
    await user.click(trigger);
    await screen.findByText("Open Columns");

    await user.type(input(), "c"); // one character — still under SEARCH_MIN_CHARS
    // A plain case-insensitive substring over the LABELS — actions first, destinations after.
    await waitFor(() =>
      expect(optionLabels()).toEqual([
        "Clear filtersthis page",
        "Open Columnsthis page",
        "Unmatched→",
        "Coverage→",
        "Activity→",
      ]),
    );
    // The saved views are gone: neither name contains a "c".
    expect(screen.queryByText(/apply view/i)).toBeNull();
    // …and no request was made for a one-character term.
    await new Promise((r) => setTimeout(r, 600));
    expect(searchCalls()).toHaveLength(0);
  });

  it("N6-71: at ≥2 characters matching actions sit ABOVE the untouched search groups", async () => {
    views = [{ ...VIEW_HOT, id: "v9", name: "Whitfield sweep" }];
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "whitf");

    // Actions first, then today's groups in today's order.
    await waitFor(() => expect(groupHeadings()).toEqual(["Actions", "Leads · 2", "Partners · 1"]));
    expect(optionLabels()[0]).toContain("Apply view: Whitfield sweep");
    // The search half is untouched: both leads and the partner are still there.
    expect(options()).toHaveLength(4);
  });

  it("N6-71: a query matching nothing local still shows the search's own empty state", async () => {
    payload = none();
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.type(input(), "zzzz");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("N6-74: the footer advertises ↵ run alongside ↵ open", async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    expect(screen.getByText("↵ run")).toBeInTheDocument();
    expect(screen.getByText("↵ open")).toBeInTheDocument();
  });

  it("N6-71: a failed saved-views read degrades to no Actions group, not an error", async () => {
    apiGet.mockImplementationOnce(async () => {
      throw new Error("views are down");
    });
    const { user, trigger } = setup();
    await user.click(trigger);

    expect(await screen.findByText("Go to")).toBeInTheDocument();
    expect(screen.queryByText(/apply view/i)).toBeNull();
    expect(screen.queryByText(/couldn't/i)).toBeNull();
  });

  // ── The owner's pin: navigate + views ONLY ──────────────────────────────────────────────
  // Two independent legs, because either alone is weak. The allowlist would pass a "Delete
  // view: X" that someone named innocently; the no-write leg would pass an action that mutates
  // through some future non-apiMutate path. Together they say: these rows, and they don't write.
  it("N6-72: the action registry contains NO mutating action (owner pin)", async () => {
    pathname = "/leads";
    const { user, trigger } = setup();
    await user.click(trigger);
    await screen.findByText("Apply view: Hot in AZ");

    const actionRows = options()
      .slice(0, 4) // the Actions group: two views + the two page actions
      .map((o) => o.textContent ?? "");
    expect(actionRows).toEqual([
      "Apply view: Hot in AZ",
      "Apply view: Probate list",
      "Clear filtersthis page",
      "Open Columnsthis page",
    ]);
    // Every label is an APPLY/CLEAR/OPEN — no verb in the registry changes a lead. A new action
    // that did would have to be added to this list by hand, which is the point.
    for (const label of actionRows) {
      expect(label).toMatch(/^(Apply view: |Clear filters|Open Columns)/);
    }
    await user.keyboard("{Escape}");

    // …and running each of them writes nothing.
    for (const label of ["Apply view: Hot in AZ", "Apply view: Probate list", "Clear filters", "Open Columns"]) {
      await user.click(trigger);
      await user.click(await screen.findByText(label));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    expect(apiMutate).not.toHaveBeenCalled();
    // What DID happen: four dispatches to the leads page, and no navigation.
    expect(fired.map((e) => e.type)).toEqual([
      LEADS_APPLY_VIEW_EVENT,
      LEADS_APPLY_VIEW_EVENT,
      LEADS_CLEAR_FILTERS_EVENT,
      LEADS_OPEN_COLUMNS_EVENT,
    ]);
    expect(push).not.toHaveBeenCalled();
  });
});
