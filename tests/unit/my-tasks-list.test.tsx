// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";
import { MyTasksList, type MyTask } from "@/components/MyTasksList";

// WP-TSK-5: MyTasksList is the shared "My Tasks" list (TSK-07) behind both the admin
// /tasks page and the portal /portal/tasks page. Mirrors tests/unit/tasks-panel.test.tsx's
// harness (same fetch-stub + ToastProvider pattern) since the toggle mutation is the same
// shape (TSK-04).

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

function jsonRes(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

const TODAY = "2026-08-15";

function task(overrides: Partial<MyTask>): MyTask {
  return {
    id: "t1",
    title: "Call seller to schedule walkthrough",
    dueOn: "2026-08-14",
    assignedToUserId: "u1",
    authorUserId: "u1",
    authorRole: "admin",
    doneAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    // C-11: the payload's resolved identities. My Tasks does not render them (every row is
    // the viewer's own) — they are here so the fixture matches the /api/tasks shape.
    assignee: { email: "casey@meridian.test", role: "admin", deactivated: false },
    author: { email: "casey@meridian.test", role: "admin", deactivated: false },
    leadRefId: "LD-25-01847",
    leadSeller: "Marcus Whitfield",
    leadCity: "Phoenix",
    leadState: "AZ",
    group: "overdue",
    ...overrides,
  };
}

const OVERDUE = task({ id: "t1", title: "Call seller to schedule walkthrough", dueOn: "2026-08-14", leadRefId: "LD-25-01847", group: "overdue" });
const TODAY_TASK = task({ id: "t2", title: "Send comps + preliminary offer range", dueOn: "2026-08-15", leadRefId: "LD-25-01793", group: "today" });
const UPCOMING = task({ id: "t3", title: "Re-check MLS status before offer", dueOn: "2026-08-18", leadRefId: "LD-25-01802", group: "upcoming" });
const NO_DUE = task({ id: "t4", title: "Quarterly nurture check-in", dueOn: null, leadRefId: "LD-25-01640", group: "none" });

function page(items: MyTask[], total = items.length) {
  return { items, page: 1, pageSize: 20, total };
}

// ── loading / empty / error states (§6.17 state matrix) ─────────────────────────
describe("DSN-03: MyTasksList — loading/empty/error states", () => {
  it("shows an empty state when the actor has no open tasks", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes(page([]))) as unknown as typeof fetch);
    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);
    expect(await screen.findByText("No open tasks")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("UX7-01: a task row shows the lead's identity (seller + city/state), not just the ref", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes(page([OVERDUE]))) as unknown as typeof fetch);
    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);
    // The two identical "Call seller…" rows the audit flagged are now distinguishable.
    expect(await screen.findByText("Marcus Whitfield")).toBeInTheDocument();
    expect(screen.getByText(/Phoenix, AZ/)).toBeInTheDocument();
    // The deep-link ref stays.
    expect(screen.getByRole("link", { name: "LD-25-01847" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("surfaces a failed load as QueryErrorState with a Retry action", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ code: "my_tasks_failed", message: "Could not load your tasks." }, false)) as unknown as typeof fetch);
    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);
    expect(await screen.findByText(/couldn't load your tasks/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

// ── TSK-07/TSK-10: client-side grouping ──────────────────────────────────────────
describe("TSK-07/TSK-10: due-date grouping (overdue/today/upcoming/no-date)", () => {
  it("groups the fetched page into Overdue / Today / Upcoming / No due date, in that order, with per-group counts", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes(page([OVERDUE, TODAY_TASK, UPCOMING, NO_DUE]))) as unknown as typeof fetch);
    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);

    await screen.findByText(OVERDUE.title);
    // Each group renders as a real <h3> (TSK-07/TSK-10) — assert both its presence, its
    // count, AND the DUE_GROUPS render order in one pass over the heading list.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
    expect(headings).toHaveLength(4);
    expect(headings[0]).toContain("Overdue");
    expect(headings[0]).toContain("1");
    expect(headings[1]).toContain("Today");
    expect(headings[2]).toContain("Upcoming");
    expect(headings[3]).toContain("No due date");

    // Each task appears under its own group.
    expect(screen.getByText(OVERDUE.title)).toBeInTheDocument();
    expect(screen.getByText(TODAY_TASK.title)).toBeInTheDocument();
    expect(screen.getByText(UPCOMING.title)).toBeInTheDocument();
    expect(screen.getByText(NO_DUE.title)).toBeInTheDocument();
  });

  it("omits an empty group entirely rather than rendering a zero-count section", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes(page([TODAY_TASK]))) as unknown as typeof fetch);
    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);
    await screen.findByText(TODAY_TASK.title);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toContain("Today");
  });

  it("shows the overdue-count pill only when the fetched page has an overdue task", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes(page([OVERDUE, TODAY_TASK]))) as unknown as typeof fetch);
    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);
    expect(await screen.findByText("1 overdue")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("a completed task is never re-grouped by due date (Done tab renders a flat list)", async () => {
    const done = task({ id: "t5", title: "Initial contact", dueOn: "2026-01-01", doneAt: "2026-08-12T14:00:00.000Z", leadRefId: "LD-25-00001" });
    const fetchSpy = vi.fn((url: string) =>
      url.includes("status=done") ? jsonRes(page([done])) : jsonRes(page([OVERDUE])),
    );
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const user = userEvent.setup();
    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);
    await screen.findByText(OVERDUE.title);

    await user.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByText("Initial contact");
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull(); // no group heading — flat list
    // The due chip reads the COMPLETION date (Aug 12), never the long-past dueOn (Jan 1) —
    // dueChipFor's doneAt-takes-priority rule (TSK-04), same as TasksPanel. The date
    // fragment renders in its own `num` span (design F-3), so match on the chip's full
    // textContent rather than a single text node.
    expect(screen.getByText((_, el) => el?.textContent === "Done · Aug 12")).toBeInTheDocument();
  });
});

// ── Done toggle switches the query ──────────────────────────────────────────────
describe("TSK-07: the Open/Done segmented control switches ?status=", () => {
  it("clicking Done refetches with status=done; clicking Open goes back", async () => {
    const fetchSpy = vi.fn((url: string) =>
      url.includes("status=done") ? jsonRes(page([])) : jsonRes(page([OVERDUE])),
    );
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const user = userEvent.setup();
    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);
    await screen.findByText(OVERDUE.title);
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("status=open"));

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("status=done")));
    await screen.findByText("No completed tasks yet"); // WP-UX-7: Done tab's own empty copy

    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByText(OVERDUE.title)).toBeInTheDocument());
  });
});

// ── TSK-04: optimistic complete/reopen + rollback on failure ────────────────────
describe("TSK-04: checkbox toggle is optimistic and rolls back on failure", () => {
  it("completing a task flips the checkbox immediately, then reverts + toasts on a failed PATCH", async () => {
    const user = userEvent.setup();
    let resolvePatch!: (v: unknown) => void;
    const patchPromise = new Promise((resolve) => {
      resolvePatch = resolve;
    });
    const fetchSpy = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return jsonRes(page([OVERDUE]));
      if (method === "PATCH") return patchPromise;
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);
    await screen.findByText(OVERDUE.title);
    const checkbox = screen.getByRole("checkbox", { name: `Mark "${OVERDUE.title}" done` });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: `Reopen "${OVERDUE.title}"` })).toBeChecked());

    // Scoped to the visible stack (the sr-only live region double-matches otherwise).
    resolvePatch({ ok: false, json: () => Promise.resolve({ message: "Could not update task." }) });
    const toastStack = screen.getByTestId("toast-stack");
    expect(await within(toastStack).findByText(/could not update task/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: `Mark "${OVERDUE.title}" done` })).not.toBeChecked());

    vi.unstubAllGlobals();
  });
});

// ── deep-link correctness ────────────────────────────────────────────────────────
describe("TSK-07: lead deep link matches the house ?open=<ref> convention", () => {
  it("admin: builds the /leads?open=<ref> href from leadHrefBase", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes(page([OVERDUE]))) as unknown as typeof fetch);
    wrap(<MyTasksList leadHrefBase="/leads?open=" today={TODAY} />);
    const link = await screen.findByRole("link", { name: OVERDUE.leadRefId });
    expect(link).toHaveAttribute("href", `/leads?open=${OVERDUE.leadRefId}`);
    vi.unstubAllGlobals();
  });

  it("portal: builds the /portal/leads?open=<ref> href from leadHrefBase", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes(page([OVERDUE]))) as unknown as typeof fetch);
    wrap(<MyTasksList leadHrefBase="/portal/leads?open=" today={TODAY} />);
    const link = await screen.findByRole("link", { name: OVERDUE.leadRefId });
    expect(link).toHaveAttribute("href", `/portal/leads?open=${OVERDUE.leadRefId}`);
    vi.unstubAllGlobals();
  });
});
