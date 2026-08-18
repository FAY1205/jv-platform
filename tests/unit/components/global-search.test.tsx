// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// SRCH-02 — the Ctrl-K overlay: debounced server search, full keyboard operation,
// escape-safe highlighting, and the three async states.

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));

type Payload = {
  leads: { total: number; rows: unknown[] };
  partners: { total: number; rows: unknown[] };
};
let payload: Payload;
let failWith: Error | null = null;

const apiGet = vi.fn(async (url: string) => {
  if (failWith) throw failWith;
  const q = new URL(url, "http://localhost").searchParams.get("q") ?? "";
  return { q, ...payload };
});
vi.mock("@/lib/api", () => ({ apiGet: (url: string) => apiGet(url) }));

import { GlobalSearchOverlay, GlobalSearchTrigger } from "@/components/GlobalSearch";

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

beforeEach(() => {
  payload = full();
  failWith = null;
  apiGet.mockClear();
  push.mockClear();
});
afterEach(() => {
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
    expect(apiGet).not.toHaveBeenCalled();

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
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
    await user.type(input(), "w");
    expect(await screen.findByText(/type at least 2 characters/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 600));
    expect(apiGet).not.toHaveBeenCalled();
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
    expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument();
  });
});
