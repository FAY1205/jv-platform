// @vitest-environment jsdom
import * as React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// N5-11/12/13/15 — inline per-field editing on the admin lead record: single-key PATCHes,
// rollback + retry, Esc precedence over the panel, and two concurrent field saves.

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
vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

const REF = "LD-26-00929";
const REF2 = "LD-26-00930";
function baseDetail(refId = REF) {
  return {
    refId,
    seller: { first: "Robert", last: "Thompson", phone: "(859) 938-9128", email: "rt@example.test" },
    address: "8193 Maple St", city: "Dallas", state: "TX", zip: "75045",
    campaign: "Direct mail", notes: "Roof replaced 2019.", reasonForSelling: "Relocation / moving", motivation: "",
    timeToSell: "Within 1-3 months", mlsStatus: "kept" as const, mlsReason: "", status: "New",
    score: { total: 41, group: "hot" as const, status: "complete" as const, breakdown: null },
    editable: true, receivedAt: "2026-08-13T10:00:00.000Z", modifiedAt: null,
    partner: { id: "p1", name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
    assignment: { manual: false, assignedAt: null, matchMethod: "zip", matchedOn: "75045", original: null },
    availableStatuses: ["New", "Contacted"],
    activity: [],
  };
}
let detail = baseDetail();
let detailReads = 0;

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url.includes("/api/me")) {
        return { email: "a@example.test", role: "admin", capabilities: ["leads.read", "leads.write", "work.write", "views.own"], workspace: { name: "W" }, isPlatformOwner: false };
      }
      if (url.includes("/notes")) return { notes: [] };
      if (url.includes("/tasks")) return { tasks: [] };
      if (url.includes("/partners")) return { partners: [{ id: "p1", refId: "JV-001", name: "Meridian Buyers", color: "#5B7A9E" }] };
      detailReads += 1;
      // The switch tests open a SECOND record; everything else reads the mutable `detail`.
      return url.endsWith(REF2) ? baseDetail(REF2) : detail;
    }),
  };
});

import { ToastProvider } from "@/components";
import { LeadDialog } from "@/app/(admin)/leads/lead-dialog";

/** A fetch stub for the write path (apiMutate). Resolves ok by default. */
function stubFetch(impl?: (url: string, opts: RequestInit) => { ok: boolean; status?: number; body?: unknown }) {
  const spy = vi.fn((url: string, opts: RequestInit) => {
    const r = impl?.(url, opts) ?? { ok: true, body: { refId: REF } };
    return Promise.resolve({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: () => Promise.resolve(r.body ?? {}) });
  });
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

function patchBodies(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls
    .filter(([, o]) => (o as RequestInit).method === "PATCH")
    .map(([, o]) => JSON.parse((o as RequestInit).body as string));
}

function renderPanel(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LeadDialog refId={REF} onClose={onClose} nav={null} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

/** The VISIBLE toast row. The provider also mirrors every message into an sr-only live
 *  region (R-56), so an unscoped query legitimately finds two of everything. */
async function toastText(text: string | RegExp) {
  return within(await screen.findByTestId("toast-stack")).findByText(text);
}

/** Open the named field and replace its (pre-selected) value. */
async function editField(user: ReturnType<typeof userEvent.setup>, label: string, next: string) {
  await user.click(await screen.findByRole("button", { name: new RegExp(`^${label}:`, "i") }));
  await user.keyboard(next);
}

beforeEach(() => {
  detail = baseDetail();
  detailReads = 0;
  vi.unstubAllGlobals();
});

describe("N5-11: commit-on-blur writes ONE field", () => {
  it("N5-11: Enter PATCHes a single-key `fields` payload for that field alone", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch();
    renderPanel();

    await editField(user, "Phone", "(918) 555-0170");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(patchBodies(fetchSpy)).toHaveLength(1));
    const [url, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/leads/${REF}`);
    expect(opts.method).toBe("PATCH");
    expect(patchBodies(fetchSpy)[0]).toEqual({ fields: { phone: "(918) 555-0170" } });
  });

  it("N5-11: an unchanged value costs no request at all", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /^Phone:/i }));
    await user.keyboard("{Enter}");

    expect(patchBodies(fetchSpy)).toHaveLength(0);
  });

  it("N5-14: a successful save refetches the lead detail, so the new timeline entry appears", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderPanel();
    await screen.findByRole("button", { name: /^Phone:/i });
    const before = detailReads;

    await editField(user, "Phone", "(918) 555-0170");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(detailReads).toBeGreaterThan(before));
  });
});

describe("N5-11: optimistic paint, rollback, and the retry toast", () => {
  it("N5-11: a failed save rolls the value back and toasts 'Couldn't save <Field>'", async () => {
    const user = userEvent.setup();
    stubFetch(() => ({ ok: false, status: 500, body: { code: "lead_edit_failed", message: "Edit failed." } }));
    renderPanel();

    await editField(user, "Phone", "(918) 555-0170");
    await user.keyboard("{Enter}");

    expect(await toastText("Couldn't save Phone")).toBeInTheDocument();
    // Rolled back to the record's value — the optimistic one is gone.
    await waitFor(() => expect(screen.getByText("(859) 938-9128")).toBeInTheDocument());
    expect(screen.queryByText("(918) 555-0170")).toBeNull();
  });

  it("N5-11: the toast's Retry reopens the field with the text that failed", async () => {
    const user = userEvent.setup();
    stubFetch(() => ({ ok: false, status: 500, body: { message: "Edit failed." } }));
    renderPanel();

    await editField(user, "Phone", "(918) 555-0170");
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("(918) 555-0170");
  });

  it("N5-12: a 4xx (an address/ZIP dedupe collision) surfaces the SERVER's message in the toast", async () => {
    const user = userEvent.setup();
    stubFetch(() => ({ ok: false, status: 409, body: { code: "duplicate", message: "Another lead already has this address." } }));
    renderPanel();

    await editField(user, "Address", "1 Same St");
    await user.keyboard("{Enter}");

    expect(await toastText(/Couldn't save Address — Another lead already has this address\./)).toBeInTheDocument();
  });

  it("C-17: a 5xx's deliberately static message is NOT echoed — the toast says it once", async () => {
    const user = userEvent.setup();
    stubFetch(() => ({ ok: false, status: 500, body: { message: "Edit failed." } }));
    renderPanel();

    await editField(user, "Phone", "x");
    await user.keyboard("{Enter}");

    expect(await toastText("Couldn't save Phone")).toBeInTheDocument();
    expect(within(screen.getByTestId("toast-stack")).queryByText(/Edit failed\./)).toBeNull();
  });
});

describe("N5-15: concurrent field saves", () => {
  it("N5-15: two rapid edits to different fields both persist, each as its own single-key patch", async () => {
    const user = userEvent.setup();
    // Both requests stay in flight until released, so the second is issued while the first
    // is still open — the case that would clobber if the payload carried a whole record.
    const gates: (() => void)[] = [];
    const fetchSpy = vi.fn(
      () => new Promise((resolve) => gates.push(() => resolve({ ok: true, status: 200, json: () => Promise.resolve({ refId: REF }) }))),
    );
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    renderPanel();

    await editField(user, "Phone", "(918) 555-0170");
    await user.keyboard("{Enter}");
    await editField(user, "City", "Austin");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const bodies = patchBodies(fetchSpy as unknown as ReturnType<typeof stubFetch>);
    expect(bodies).toEqual([{ fields: { phone: "(918) 555-0170" } }, { fields: { city: "Austin" } }]);
    gates.forEach((g) => g());
  });

  it("N5-15: a save landing for one field does not touch another field's open draft", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderPanel();

    await editField(user, "Phone", "(918) 555-0170");
    await user.keyboard("{Enter}");
    // Open City and start typing while the phone save + its refetch are still settling.
    await editField(user, "City", "Aust");

    // The refetch returns the ORIGINAL record (the mock is stale on purpose) — a re-seed
    // from it would drop "Aust" on the floor.
    await waitFor(() => expect(detailReads).toBeGreaterThan(1));
    expect(screen.getByRole("textbox", { name: "City" })).toHaveValue("Aust");
  });
});

describe("N5-13: Esc precedence", () => {
  it("N5-13: the first Esc reverts the field and leaves the panel open; the next Esc closes it", async () => {
    const user = userEvent.setup();
    stubFetch();
    const { onClose } = renderPanel();

    await editField(user, "Phone", "typed over");
    await user.keyboard("{Escape}");

    // The edit consumed it: no textbox, no close, and the old value is back.
    expect(screen.queryByRole("textbox", { name: "Phone" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("(859) 938-9128")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("N5-13: with no field open, the FIRST Esc closes the panel (the hold is not sticky)", async () => {
    const user = userEvent.setup();
    stubFetch();
    const { onClose } = renderPanel();
    await screen.findByRole("button", { name: /^Phone:/i });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});

describe("N5-02: a record switch drops every per-record draft", () => {
  /** The cached list row a click opens the panel from — enough for `adminLeadPlaceholder`. */
  const row = (refId: string, seller: string) => ({
    refId, seller, address: "8193 Maple St", city: "Dallas", state: "TX", zip: "75045",
    campaign: "Direct mail", mlsStatus: "kept" as const, status: "New", scoreTotal: 41,
    scoreGroup: "hot" as const, partner: { id: "p1", name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
    receivedAt: "2026-08-13T10:00:00.000Z", modifiedAt: null, tags: [],
  });

  it("N5-02/N5-15: switching in place clears the admin-note draft and any open inline field", async () => {
    const user = userEvent.setup();
    stubFetch();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    // ⚠️ The list cache is what makes this test NON-VACUOUS. With it, C-41b's placeholder
    // resolves the new ref instantly, so the panel body never unmounts on its own — the
    // no-gap path a row click actually takes. Without it the second record would go through
    // a pending skeleton, which unmounts everything and would pass even with the bug.
    qc.setQueryData(["leads", "q|received|desc", 1, 20], {
      leads: [row(REF, "Robert Thompson"), row(REF2, "Dana Vance")],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    const ui = (ref: string) => (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <LeadDialog refId={ref} onClose={vi.fn()} nav={null} />
        </ToastProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(ui(REF));

    // Two half-finished drafts on the first record: a typed-but-unsent admin note…
    const composer = await screen.findByPlaceholderText(/note/i);
    await user.type(composer, "half-typed admin note");
    expect(composer).toHaveValue("half-typed admin note");
    // …and an inline field open with unsaved text.
    await editField(user, "City", "Aust");
    expect(screen.getByRole("textbox", { name: "City" })).toHaveValue("Aust");

    // What a row click behind the open panel looks like to this component.
    rerender(ui(REF2));

    // Same panel element — the switch really is in place, not a close/reopen.
    expect(await screen.findByRole("dialog", { name: new RegExp(REF2) })).toBeInTheDocument();
    // Neither draft followed the switch onto the next lead.
    expect(screen.getByPlaceholderText(/note/i)).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "City" })).toBeNull();
    await waitFor(() => expect(screen.getByText("Dana")).toBeInTheDocument());
  });
});

describe("N5-12: the editable roster is exactly the EditForm's", () => {
  it("N5-12: the twelve roster fields edit inline and nothing else does", async () => {
    stubFetch();
    renderPanel();
    for (const label of ["First name", "Last name", "Phone", "Email", "Address", "City", "State", "ZIP", "Source", "Reason for selling", "Time to sell"]) {
      expect(await screen.findByRole("button", { name: new RegExp(`^${label}:`, "i") })).toBeInTheDocument();
    }
    // The twelfth (Source notes) is the boxed multiline variant, with its own edit control.
    expect(screen.getByRole("button", { name: /^Edit Source notes$/i })).toBeInTheDocument();

    // Not editable: Received and Routed by carry no control, and Motivation is not rendered.
    expect(screen.queryByRole("button", { name: /^Received:/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Routed by:/i })).toBeNull();
    expect(screen.queryByText(/motivation/i)).toBeNull();
  });

  it("Q4: the property's Google search survives as the address field's trailing link", async () => {
    stubFetch();
    renderPanel();
    const link = await screen.findByRole("link", { name: /search this property on google/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("google.com/search"));
    expect(link).toHaveAttribute("href", expect.stringContaining("8193"));
  });
});
