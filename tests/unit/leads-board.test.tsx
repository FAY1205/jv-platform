// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";
import { LeadsBoard } from "@/app/(admin)/leads/leads-board";

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

// KAN-10 instrumentation (pr F-3): count how many times each COLUMN renders. The column
// header's dot and the cards are no good as probes — cards are memoized too, and the
// ⋯ menu builds a dot per status on every card render. An EMPTY column's <EmptyState>,
// though, is rendered by the column and nothing else, and its description carries the
// status — so one counter per description == one counter per column render.
const { emptyStateRenders } = vi.hoisted(() => ({ emptyStateRenders: {} as Record<string, number> }));
vi.mock("@/components", async (orig) => {
  const actual = await orig<typeof import("@/components")>();
  return {
    ...actual,
    EmptyState: (props: React.ComponentProps<typeof actual.EmptyState>) => {
      const key = String(props.description ?? props.title);
      emptyStateRenders[key] = (emptyStateRenders[key] ?? 0) + 1;
      return actual.EmptyState(props);
    },
  };
});

// WP-KAN-1 component coverage: the board's own behaviour — drag = the EXISTING status
// endpoint, optimistic with rollback (KAN-04), the same-column no-op, the keyboard
// "Move to…" path (KAN-05), click-vs-drag (KAN-06), per-column load more (KAN-02) and
// the DSN-03 state matrix. Radix's menu needs the same jsdom pointer stubs the other
// Radix-backed suites install.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => vi.unstubAllGlobals());

const NOW = new Date("2026-08-15T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

type Card = {
  refId: string; seller: string; city: string | null; state: string | null;
  partner: { name: string; refId: string; color: string } | null;
  hot: boolean; scoreTotal: number | null; statusSince: string;
};
const card = (refId: string, over: Partial<Card> = {}): Card => ({
  refId,
  seller: "Marcus Whitfield",
  city: "Phoenix",
  state: "AZ",
  partner: { name: "Cedar Ridge Capital", refId: "JV-004", color: "#2F6DB0" },
  hot: false,
  scoreTotal: null,
  statusSince: daysAgo(3),
  ...over,
});

const STATUSES = ["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead"];
/** A board payload with the given cards per column (absent columns are empty). */
function payload(by: Record<string, { cards: Card[]; total?: number; page?: number }>) {
  return {
    pageSize: 25,
    columns: STATUSES.map((status) => ({
      status,
      page: by[status]?.page ?? 1,
      total: by[status]?.total ?? by[status]?.cards.length ?? 0,
      cards: by[status]?.cards ?? [],
    })),
  };
}

const json = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const column = (status: string) => screen.getByTestId(`board-column-${status}`);
const noFilters = { partnerId: "", hot: false };

// ── render (KAN-02/03/08) ─────────────────────────────────────────────────────
describe("KAN-02: LeadsBoard renders six columns of cards", () => {
  it("KAN-02/03/08: columns carry true totals; cards carry ref, seller, place, partner or Unmatched, hot mark and age", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(payload({
      New: {
        total: 26,
        cards: [
          card("LD-26-00001", { hot: true, scoreTotal: 41 }),
          card("LD-26-00002", { seller: "June Park", city: "Norfolk", state: "VA", partner: null, statusSince: daysAgo(16) }),
        ],
      },
    }))) as unknown as typeof fetch);

    wrap(<LeadsBoard filters={noFilters} onOpen={() => {}} now={NOW} />);

    await screen.findByTestId("board-card-LD-26-00001");
    for (const s of STATUSES) expect(screen.getByRole("heading", { name: s })).toBeInTheDocument();
    // True total, not the page length — and it is in the column's accessible name too.
    expect(screen.getByRole("region", { name: "New — 26 leads" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Closed — 0 leads" })).toBeInTheDocument();

    const hot = within(column("New")).getByTestId("board-card-LD-26-00001");
    expect(within(hot).getByRole("button", { name: "LD-26-00001" })).toBeInTheDocument();
    expect(within(hot).getByText("Marcus Whitfield")).toBeInTheDocument();
    expect(within(hot).getByText("Phoenix, AZ")).toBeInTheDocument();
    expect(within(hot).getByText("Cedar Ridge Capital")).toBeInTheDocument();
    expect(within(hot).getByRole("img", { name: /hot lead — 41 out of 50/i })).toBeInTheDocument();
    expect(within(hot).getByText("3d in status")).toBeInTheDocument();

    // KAN-08 + KAN-03: unmatched says so in words; a stale card carries ⚠ AND the count.
    const stale = within(column("New")).getByTestId("board-card-LD-26-00002");
    expect(within(stale).getByText("Unmatched")).toBeInTheDocument();
    expect(within(stale).getByText(/⚠\s*16d in status/)).toBeInTheDocument();
  });

  it("DSN-03: each column shows its own empty state, and a failed board fetch offers Retry", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(payload({}))) as unknown as typeof fetch);
    const { unmount } = wrap(<LeadsBoard filters={noFilters} onOpen={() => {}} now={NOW} />);
    expect(await screen.findAllByText("No leads")).toHaveLength(6);
    unmount();
    vi.unstubAllGlobals();

    vi.stubGlobal("fetch", vi.fn(() => json({ code: "leads_board_failed", message: "Failed to load the board" }, false)) as unknown as typeof fetch);
    wrap(<LeadsBoard filters={noFilters} onOpen={() => {}} now={NOW} />);
    expect(await screen.findByText(/couldn't load the board/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});

// ── KAN-04: drag → the EXISTING status endpoint, optimistic + rollback ────────
describe("KAN-04: dragging a card moves it via POST /api/leads/{ref}/status", () => {
  function dragBoard(statusPost: (url: string) => ReturnType<typeof json>) {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchSpy = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      calls.push({ url, method, body: opts?.body as string | undefined });
      if (method === "GET") return json(payload({ New: { cards: [card("LD-26-00001")] } }));
      return statusPost(url);
    });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    return calls;
  }

  it("KAN-04: the card lands in the target column before the request resolves, and the request is the existing endpoint", async () => {
    let resolvePost!: (v: unknown) => void;
    const pending = new Promise((r) => { resolvePost = r; });
    const calls = dragBoard(() => pending as ReturnType<typeof json>);

    wrap(<LeadsBoard filters={noFilters} onOpen={() => {}} now={NOW} />);
    const cardEl = await screen.findByTestId("board-card-LD-26-00001");

    fireEvent.dragStart(cardEl);
    // DSN-03 drag states: the dragged card dims, and the column under the pointer
    // marks itself a valid drop target.
    await waitFor(() => expect(cardEl).toHaveAttribute("data-dragging", "true"));
    fireEvent.dragOver(column("Contacted"));
    await waitFor(() => expect(column("Contacted")).toHaveAttribute("data-over", "true"));

    fireEvent.drop(column("Contacted"));

    // Optimistic: it is in Contacted while the POST is still in flight.
    await waitFor(() => expect(within(column("Contacted")).getByTestId("board-card-LD-26-00001")).toBeInTheDocument());
    expect(within(column("New")).queryByTestId("board-card-LD-26-00001")).toBeNull();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/leads/LD-26-00001/status");
    expect(JSON.parse(post.body!)).toEqual({ status: "Contacted" });

    resolvePost({ ok: true, status: 200, json: () => Promise.resolve({ refId: "LD-26-00001", status: "Contacted" }) });
    const toastStack = screen.getByTestId("toast-stack");
    expect(await within(toastStack).findByText("LD-26-00001 → Contacted")).toBeInTheDocument();
  });

  it("KAN-04: a failed move rolls the card back to its column and toasts the reason", async () => {
    dragBoard(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ code: "lead_removed", message: "Lead was removed from MLS." }) }) as ReturnType<typeof json>);

    wrap(<LeadsBoard filters={noFilters} onOpen={() => {}} now={NOW} />);
    const cardEl = await screen.findByTestId("board-card-LD-26-00001");

    fireEvent.dragStart(cardEl);
    fireEvent.drop(column("Dead"));

    // Scoped to the visible toast stack — the message is mirrored into an sr-only
    // aria-live region too, so an unscoped query matches twice and never resolves.
    const toastStack = screen.getByTestId("toast-stack");
    expect(await within(toastStack).findByText(/removed from mls/i)).toBeInTheDocument();
    await waitFor(() => expect(within(column("New")).getByTestId("board-card-LD-26-00001")).toBeInTheDocument());
    expect(within(column("Dead")).queryByTestId("board-card-LD-26-00001")).toBeNull();
  });

  it("KAN-04: dropping a card on its OWN column is a no-op — no request at all", async () => {
    const calls = dragBoard(() => json({}));

    wrap(<LeadsBoard filters={noFilters} onOpen={() => {}} now={NOW} />);
    const cardEl = await screen.findByTestId("board-card-LD-26-00001");

    fireEvent.dragStart(cardEl);
    fireEvent.dragOver(column("New"));
    fireEvent.drop(column("New"));

    await waitFor(() => expect(within(column("New")).getByTestId("board-card-LD-26-00001")).toBeInTheDocument());
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    // The source column never lights up as a drop target either.
    expect(column("New")).not.toHaveAttribute("data-over");
  });
});

// ── KAN-10: a move re-renders only the two columns it touches ────────────────
describe("KAN-10: moving a card does not re-render the whole board", () => {
  it("KAN-10: the four untouched columns do not re-render while a card moves between the other two", async () => {
    let resolvePost!: (v: unknown) => void;
    const pending = new Promise((r) => { resolvePost = r; });
    vi.stubGlobal("fetch", vi.fn((url: string, opts?: RequestInit) => {
      if ((opts?.method ?? "GET") === "GET") {
        return json(payload({
          New: { cards: [card("LD-26-00001"), card("LD-26-00002")] },
          Contacted: { cards: [card("LD-26-00003")] },
        }));
      }
      return pending as ReturnType<typeof json>;
    }) as unknown as typeof fetch);

    wrap(<LeadsBoard filters={noFilters} onOpen={() => {}} now={NOW} />);
    await screen.findByTestId("board-card-LD-26-00001");

    // Baseline AFTER the first paint has settled — the four empty columns each rendered.
    const untouched = ["Appointment", "Under contract", "Closed", "Dead"];
    const before = Object.fromEntries(untouched.map((s) => [s, emptyStateRenders[`Nothing is in ${s} yet.`] ?? 0]));
    expect(Object.values(before).every((n) => n > 0)).toBe(true); // the probe really is wired up

    fireEvent.dragStart(screen.getByTestId("board-card-LD-26-00001"));
    fireEvent.drop(column("Contacted"));

    // The move landed (both touched columns re-rendered — the card left one and joined
    // the other)…
    await waitFor(() => expect(within(column("Contacted")).getByTestId("board-card-LD-26-00001")).toBeInTheDocument());
    expect(within(column("New")).getByTestId("board-card-LD-26-00002")).toBeInTheDocument();

    // …while every other column's subtree was skipped entirely: the optimistic cache
    // update hands back the SAME column object for anything it didn't touch, so
    // React.memo bails out. The POST is still in flight, so no refetch has muddied this.
    // (Verified non-vacuous: dropping the React.memo wrapper takes each of these 1 → 2.)
    for (const s of untouched) {
      expect(emptyStateRenders[`Nothing is in ${s} yet.`] ?? 0, `${s} re-rendered during the move`).toBe(before[s]);
    }

    resolvePost({ ok: true, status: 200, json: () => Promise.resolve({ refId: "LD-26-00001", status: "Contacted" }) });
    const toastStack = screen.getByTestId("toast-stack");
    expect(await within(toastStack).findByText("LD-26-00001 → Contacted")).toBeInTheDocument();
  });
});

// ── KAN-05: the keyboard path ────────────────────────────────────────────────
describe("KAN-05: every card has a keyboard-operable Move to… menu", () => {
  it("KAN-05: opening the ⋯ menu from the keyboard and choosing a status posts the move", async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string; body?: string }[] = [];
    // A MUTABLE backing column, not a static response: onSettled invalidates + refetches,
    // so a static GET would silently put the card back where it started (a mock bug, not
    // a component one — the same trap tests/unit/tasks-panel.test.tsx documents).
    let serverStatus = "Contacted";
    vi.stubGlobal("fetch", vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      calls.push({ url, method, body: opts?.body as string | undefined });
      if (method === "GET") return json(payload({ [serverStatus]: { cards: [card("LD-26-00007")] } }));
      serverStatus = (JSON.parse(opts!.body as string) as { status: string }).status;
      return json({ refId: "LD-26-00007", status: serverStatus });
    }) as unknown as typeof fetch);

    wrap(<LeadsBoard filters={noFilters} onOpen={() => {}} now={NOW} />);
    await screen.findByTestId("board-card-LD-26-00007");

    const trigger = screen.getByRole("button", { name: "Actions for LD-26-00007" });
    trigger.focus();
    await user.keyboard("{Enter}"); // keyboard-only: no pointer involved

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Move to…")).toBeInTheDocument();
    // The five OTHER statuses — never the card's own column.
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["New", "Appointment", "Under contract", "Closed", "Dead"]);

    await user.click(within(menu).getByRole("menuitem", { name: "Appointment" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/leads/LD-26-00007/status");
    expect(JSON.parse(post.body!)).toEqual({ status: "Appointment" });
    await waitFor(() => expect(within(column("Appointment")).getByTestId("board-card-LD-26-00007")).toBeInTheDocument());
  });
});

// ── KAN-06: click vs drag ────────────────────────────────────────────────────
describe("KAN-06: a card opens the lead dialog on click, but never after a drag", () => {
  it("KAN-06: a press that stayed put opens the lead; one that travelled past the threshold does not", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(payload({ New: { cards: [card("LD-26-00001")] } }))) as unknown as typeof fetch);
    const onOpen = vi.fn();

    wrap(<LeadsBoard filters={noFilters} onOpen={onOpen} now={NOW} />);
    const cardEl = await screen.findByTestId("board-card-LD-26-00001");

    // A drag: pointer travelled 40px before release — the click must be ignored.
    fireEvent.pointerDown(cardEl, { clientX: 10, clientY: 10 });
    fireEvent.click(cardEl, { clientX: 50, clientY: 50 });
    expect(onOpen).not.toHaveBeenCalled();

    // A click: within the threshold.
    fireEvent.pointerDown(cardEl, { clientX: 10, clientY: 10 });
    fireEvent.click(cardEl, { clientX: 11, clientY: 12 });
    expect(onOpen).toHaveBeenCalledWith("LD-26-00001");
  });

  it("KAN-06: the ref id is a real button, so the dialog has a keyboard path too", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(payload({ New: { cards: [card("LD-26-00001")] } }))) as unknown as typeof fetch);
    const onOpen = vi.fn();
    const user = userEvent.setup();

    wrap(<LeadsBoard filters={noFilters} onOpen={onOpen} now={NOW} />);
    await screen.findByTestId("board-card-LD-26-00001");

    const open = screen.getByRole("button", { name: "LD-26-00001" });
    open.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("LD-26-00001");
  });
});

// ── KAN-02/10: per-column server pagination ──────────────────────────────────
describe("KAN-02: Load more fetches the next page of ONE column", () => {
  it("KAN-02: the button reports the remaining count and appends that column's page 2", async () => {
    const urls: string[] = [];
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      urls.push(url);
      if (url.includes("status=New") && url.includes("page=2")) {
        return json({ pageSize: 25, columns: [{ status: "New", page: 2, total: 26, cards: [card("LD-26-00026")] }] });
      }
      return json(payload({ New: { total: 26, cards: [card("LD-26-00001")] } }));
    }) as unknown as typeof fetch);

    wrap(<LeadsBoard filters={noFilters} onOpen={() => {}} now={NOW} />);
    await screen.findByTestId("board-card-LD-26-00001");

    const more = within(column("New")).getByRole("button", { name: "Load 1 more" });
    await user.click(more);

    await waitFor(() => expect(within(column("New")).getByTestId("board-card-LD-26-00026")).toBeInTheDocument());
    expect(urls.some((u) => u.includes("status=New") && u.includes("page=2"))).toBe(true);
    // Still one card per page — the first page was not refetched wholesale.
    expect(within(column("New")).getByTestId("board-card-LD-26-00001")).toBeInTheDocument();
  });

  it("KAN-09: the partner and hot filters travel to the endpoint", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      urls.push(url);
      return json(payload({}));
    }) as unknown as typeof fetch);

    wrap(<LeadsBoard filters={{ partnerId: "unmatched", hot: true }} onOpen={() => {}} now={NOW} />);
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls[0]).toContain("partnerId=unmatched");
    expect(urls[0]).toContain("hot=1");
  });
});
