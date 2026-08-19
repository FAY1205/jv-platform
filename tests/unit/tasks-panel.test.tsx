// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";
import {
  TasksPanel,
  taskIdentity,
  identityTooltip,
  assigneeOptions,
  initialAssigneeValue,
  buildTaskPatch,
  ASSIGN_TO_ME,
  type LeadTask,
  type TaskAssignee,
} from "@/components/TasksPanel";

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({ "x-csrf-token": "t" }) }));

// Radix primitives (the Add-task DatePicker's Popover) use pointer capture + scrollIntoView,
// neither of which jsdom implements (same stub block as tests/unit/lead-dialog-edit.test.tsx).
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

// C-11: the panel now reads ["me"] (the "You" rule + the work.write chrome gate). Seeding
// the cache with `staleTime: Infinity` keeps /api/me off every test's fetch stub — the
// lead-tasks query still fetches on mount (no cached data) and still refetches on the
// invalidation each mutation's onSettled fires.
const ME = {
  email: "casey@meridian.test",
  role: "admin" as const,
  capabilities: ["leads.read", "leads.write", "work.write", "views.own"],
  workspace: { name: "Meridian" },
  isPlatformOwner: false,
};
/** A capability-trimmed staff seat: reads, but cannot author work (ADR-0049 lets a tenant
 *  configure this for member/viewer — which is why the gate is the CAPABILITY, not a role). */
const ME_READ_ONLY = { ...ME, role: "viewer" as const, capabilities: ["leads.read", "views.own"] };

const MY_IDENTITY = { email: ME.email, role: "admin" as const, deactivated: false };
const COLLEAGUE = { email: "dana@meridian.test", role: "member" as const, deactivated: false };

/** Pass `me: null` to leave ["me"] unseeded (the still-loading case) — `undefined` would
 *  just fall back to the default parameter. */
function wrap(ui: React.ReactNode, me: unknown = ME) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  if (me !== null) qc.setQueryData(["me"], me);
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const TASK: LeadTask = {
  id: "t1",
  title: "Call seller",
  dueOn: "2026-08-14",
  assignedToUserId: "u1",
  authorUserId: "u1",
  authorRole: "admin",
  doneAt: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  assignee: MY_IDENTITY,
  author: MY_IDENTITY,
};

function jsonRes(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

// ── loading / empty / error states (§6.17 state matrix) ─────────────────────────
describe("DSN-03: TasksPanel — loading/empty/error states", () => {
  it("shows an empty state when the lead has no tasks", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tasks: [] })) as unknown as typeof fetch);
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("surfaces a failed load as QueryErrorState with a Retry action", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ code: "tasks_failed", message: "Failed to load tasks." }, false)) as unknown as typeof fetch);
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    expect(await screen.findByText(/couldn't load tasks/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    vi.unstubAllGlobals();
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
      if (method === "GET") return jsonRes({ tasks: [TASK] });
      if (method === "PATCH") return patchPromise;
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");
    const checkbox = screen.getByRole("checkbox", { name: /mark "call seller" done/i });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    // Optimistic: the box flips BEFORE the PATCH has resolved at all.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /reopen "call seller"/i })).toBeChecked());

    // The PATCH comes back a failure — the optimistic change is rolled back and toasted.
    // (Scoped to the visible toast stack — the same message is ALSO mirrored into the
    // sr-only aria-live region for screen readers, so an unscoped query sees two matches
    // and never resolves. Asserted before the checkbox check: the toast auto-dismisses
    // after TOAST_DURATION_MS, so it must be read first.)
    resolvePatch({ ok: false, json: () => Promise.resolve({ message: "Could not update task." }) });
    const toastStack = screen.getByTestId("toast-stack");
    expect(await within(toastStack).findByText(/could not update task/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /mark "call seller" done/i })).not.toBeChecked());

    vi.unstubAllGlobals();
  });
});

// ── TSK-04: completing a task never reorders the list (owner-reported misfire) ──
describe("TSK-04: the list order is stable across completion (no reorder-under-cursor)", () => {
  it("completing a task strikes it through IN PLACE — the row order is unchanged even after the refetch re-sorts server-side", async () => {
    const user = userEvent.setup();
    const alpha: LeadTask = { ...TASK, id: "t-alpha", title: "Alpha task", dueOn: "2026-08-12" };
    const beta: LeadTask = { ...TASK, id: "t-beta", title: "Beta task", dueOn: "2026-08-14" };
    // A mutable backing list that reflects the completion — the server orders done-last
    // (doneAt asc nulls first → Beta would jump above Alpha after Alpha completes). The panel
    // must NOT follow that: it keeps its own due-date order so the row stays put.
    let serverTasks: LeadTask[] = [alpha, beta];
    const fetchSpy = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") {
        // Mirror the server's done-last ordering so the test proves the CLIENT re-sorts.
        const ordered = [...serverTasks].sort((a, b) => Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt)));
        return jsonRes({ tasks: ordered });
      }
      if (method === "PATCH") {
        serverTasks = serverTasks.map((t) => (`/api/tasks/${t.id}` === url ? { ...t, doneAt: "2026-08-15T00:00:00.000Z" } : t));
        return jsonRes({ ok: true });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Alpha task");

    const order = () => screen.getAllByRole("listitem").map((li) => li.textContent?.match(/Alpha|Beta/)?.[0]);
    expect(order()).toEqual(["Alpha", "Beta"]);

    await user.click(screen.getByRole("checkbox", { name: /mark "alpha task" done/i }));
    // Alpha is now completed (struck through) but still FIRST — the row did not move, even
    // after the refetch returned Beta-first.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /reopen "alpha task"/i })).toBeChecked());
    expect(order()).toEqual(["Alpha", "Beta"]);

    vi.unstubAllGlobals();
  });
});

// ── TSK-05: two-click delete confirm, optimistic + rollback ─────────────────────
describe("TSK-05: delete is a two-click inline confirm (pr F-1)", () => {
  it("TSK-05: delete removes the row", async () => {
    const user = userEvent.setup();
    // A mutable backing list, not a static response — onSettled invalidates + refetches,
    // so the GET handler must actually reflect the delete or the refetch would silently
    // put the "optimistically removed" row right back (a test-mock bug, not a component one).
    let serverTasks = [TASK];
    const fetchSpy = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return jsonRes({ tasks: serverTasks });
      if (method === "DELETE") {
        serverTasks = serverTasks.filter((t) => `/api/tasks/${t.id}` !== url);
        return jsonRes({ code: "ok", message: "Task deleted." });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");

    // First click only reveals the inline confirm — no DELETE yet.
    await user.click(screen.getByRole("button", { name: /^delete "call seller"$/i }));
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/tasks/t1", expect.objectContaining({ method: "DELETE" }));
    expect(screen.getByRole("button", { name: /^confirm delete "call seller"$/i })).toBeInTheDocument();

    // Second click (Confirm) sends the DELETE and the row disappears.
    await user.click(screen.getByRole("button", { name: /^confirm delete "call seller"$/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/tasks/t1", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(screen.queryByText("Call seller")).toBeNull());

    vi.unstubAllGlobals();
  });

  it("TSK-05: a rejected delete rolls back and toasts", async () => {
    const user = userEvent.setup();
    let resolveDelete!: (v: unknown) => void;
    const deletePromise = new Promise((resolve) => {
      resolveDelete = resolve;
    });
    const fetchSpy = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return jsonRes({ tasks: [TASK] });
      if (method === "DELETE") return deletePromise;
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");

    await user.click(screen.getByRole("button", { name: /^delete "call seller"$/i }));
    await user.click(screen.getByRole("button", { name: /^confirm delete "call seller"$/i }));

    // Optimistic: the row is gone before the DELETE has resolved at all.
    await waitFor(() => expect(screen.queryByText("Call seller")).toBeNull());

    // The DELETE comes back a failure — the row reappears and a toast explains why
    // (scoped to the visible stack — see the toggle-rollback test above for why).
    resolveDelete({ ok: false, json: () => Promise.resolve({ message: "Could not delete task." }) });
    const toastStack = screen.getByTestId("toast-stack");
    expect(await within(toastStack).findByText(/could not delete task/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Call seller")).toBeInTheDocument());

    vi.unstubAllGlobals();
  });
});

// ── add-task validation ──────────────────────────────────────────────────────
describe("TSK-01: add-task validation and submission", () => {
  it("Add task stays disabled until a title is entered, and rejects a title over 200 chars", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tasks: [] })) as unknown as typeof fetch);
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText(/no tasks yet/i);

    await user.click(screen.getByRole("button", { name: /add a task/i }));
    const saveBtn = screen.getByRole("button", { name: /^add task$/i });
    expect(saveBtn).toBeDisabled();

    const titleInput = screen.getByLabelText(/task title/i);
    await user.type(titleInput, "a".repeat(201));
    expect(await screen.findByText(/under 200 characters/i)).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    vi.unstubAllGlobals();
  });

  it("submitting a valid title POSTs to the lead's tasks endpoint and refreshes the list", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return jsonRes({ tasks: [] });
      if (method === "POST") return jsonRes({ id: "new-task" });
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText(/no tasks yet/i);

    await user.click(screen.getByRole("button", { name: /add a task/i }));
    await user.type(screen.getByLabelText(/task title/i), "Follow up with seller");
    await user.click(screen.getByRole("button", { name: /^add task$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/leads/LD-26-00001/tasks", expect.objectContaining({ method: "POST" })));
    const call = fetchSpy.mock.calls.find(([, opts]) => (opts as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body).toEqual({ title: "Follow up with seller", dueOn: null });

    // The inline form collapses back to the "Add a task" affordance after a successful add.
    await waitFor(() => expect(screen.getByRole("button", { name: /add a task/i })).toBeInTheDocument());

    vi.unstubAllGlobals();
  });
});

// ── C-11: assignee / author identity on the row ─────────────────────────────────
describe("C-11: task identity — the pure rules", () => {
  it("C-11/TSK-03: taskIdentity is the assignee, coalescing to the author when unassigned", () => {
    expect(taskIdentity({ assignee: MY_IDENTITY, author: COLLEAGUE })).toEqual(MY_IDENTITY);
    expect(taskIdentity({ assignee: null, author: COLLEAGUE })).toEqual(COLLEAGUE);
    expect(taskIdentity({ assignee: null, author: null })).toBeNull();
  });

  it("C-11: the tooltip carries the email and the role word, and names a deactivated seat", () => {
    expect(identityTooltip(COLLEAGUE, COLLEAGUE)).toBe("dana@meridian.test · Member");
    expect(identityTooltip({ ...COLLEAGUE, deactivated: true }, null)).toBe("dana@meridian.test · Member · deactivated");
  });

  it("C-11: a differing author travels in the tooltip, never as a second identity", () => {
    expect(identityTooltip(MY_IDENTITY, COLLEAGUE)).toBe("casey@meridian.test · Admin — Added by dana@meridian.test");
    // Self-assigned (the v1 norm): the same identity is never repeated.
    expect(identityTooltip(MY_IDENTITY, MY_IDENTITY)).toBe("casey@meridian.test · Admin");
  });
});

describe("C-11: the identity cluster in the row", () => {
  const renderTasks = (tasks: LeadTask[], me: unknown = ME) => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tasks })) as unknown as typeof fetch);
    return wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />, me);
  };

  it("C-11/TSK-03: a row shows the assignee identity, coalescing to the author when assignee is null", async () => {
    renderTasks([
      { ...TASK, id: "t-a", title: "Assigned task", assignee: COLLEAGUE, author: MY_IDENTITY },
      { ...TASK, id: "t-b", title: "Unassigned task", assignee: null, author: COLLEAGUE },
    ]);
    await screen.findByText("Assigned task");
    // Two rows, two identities — and the coalescing row shows the AUTHOR, not "You".
    expect(screen.getAllByText(COLLEAGUE.email)).toHaveLength(2);
    expect(screen.queryByText("You")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("C-11: the viewer's own identity renders as 'You' (email match against /api/me)", async () => {
    renderTasks([TASK]);
    await screen.findByText("Call seller");
    expect(screen.getByText("You")).toBeInTheDocument();
    // The raw email is not ALSO printed on the row — one identity, rendered once…
    expect(screen.queryByText(ME.email)).toBeNull();
    // …but the tooltip still carries the full value and the role word.
    expect(screen.getByText("casey@meridian.test · Admin")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("C-11: while the me query is still loading the raw email renders — never a guessed 'You'", async () => {
    // No seeded ["me"], and /api/me never resolves: the identity must still render.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/api/me"
          ? new Promise(() => {})
          : jsonRes({ tasks: [TASK, { ...TASK, id: "t-orphan", title: "Orphan row", assignee: null, author: null }] }),
      ) as unknown as typeof fetch,
    );
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />, null);
    await screen.findByText("Call seller");
    expect(screen.getByText(ME.email)).toBeInTheDocument();
    expect(screen.queryByText("You")).toBeNull();
    // And no Delete anywhere yet: canDo is false while ["me"] loads, and an AUTHORLESS row
    // must not read as the viewer's own just because both emails are undefined.
    expect(screen.queryByRole("button", { name: /^delete/i })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("C-11: a row with no resolvable assignee or author renders no identity cluster", async () => {
    renderTasks([{ ...TASK, title: "Orphaned task", assignee: null, author: null }]);
    await screen.findByText("Orphaned task");
    expect(screen.queryByText("You")).toBeNull();
    expect(screen.queryByText(ME.email)).toBeNull();
    expect(screen.queryByText(COLLEAGUE.email)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("C-11: a deactivated identity still renders and the tooltip names the seat state", async () => {
    const closedSeat = { ...COLLEAGUE, deactivated: true };
    renderTasks([{ ...TASK, title: "Left-behind task", assignee: closedSeat, author: closedSeat }]);
    await screen.findByText("Left-behind task");
    expect(screen.getByText(closedSeat.email)).toBeInTheDocument();
    expect(screen.getByText(`${closedSeat.email} · Member · deactivated`)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("C-11/PRN-14: identity is conveyed in TEXT beside the avatar; the initials circle is hidden from AT", async () => {
    const { container } = renderTasks([{ ...TASK, assignee: COLLEAGUE, author: COLLEAGUE }]);
    await screen.findByText("Call seller");
    expect(container.querySelector('[aria-hidden="true"].rounded-full')).not.toBeNull();
    // The circle is decorative; the email text beside it is what carries the identity.
    expect(screen.getByText(COLLEAGUE.email)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

// ── C-11 / C-10: Delete visibility + the capability gate ────────────────────────
describe("C-11/TSK-05: Delete visibility follows authorship; the capability gates the panel", () => {
  const renderTasks = (tasks: LeadTask[], me: unknown = ME, props: Record<string, unknown> = {}) => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tasks })) as unknown as typeof fetch);
    return wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" {...props} />, me);
  };

  it("C-11/TSK-05: Delete is hidden on rows the viewer did not author (the server 404s them anyway)", async () => {
    renderTasks([
      { ...TASK, id: "mine", title: "My task", assignee: MY_IDENTITY, author: MY_IDENTITY },
      { ...TASK, id: "theirs", title: "Their task", assignee: COLLEAGUE, author: COLLEAGUE },
    ]);
    await screen.findByText("Their task");
    expect(screen.getByRole("button", { name: /^delete "my task"$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete "their task"$/i })).toBeNull();
    // Authorship is a per-row fact — the checkbox on the colleague's row stays live
    // (TSK-11: any member of the authoring stream may complete it).
    expect(screen.getByRole("checkbox", { name: /mark "their task" done/i })).toBeEnabled();
    vi.unstubAllGlobals();
  });

  it("C-11/TSK-05: a completed own task shows no Delete, but keeps its attribution", async () => {
    renderTasks([{ ...TASK, title: "Done task", doneAt: "2026-08-14T00:00:00.000Z" }]);
    await screen.findByText("Done task");
    expect(screen.queryByRole("button", { name: /^delete/i })).toBeNull();
    expect(screen.getByText("You")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("C-11/TSK-04: without work.write the checkbox and add-task trigger are disabled with a stated reason, and no Delete renders", async () => {
    renderTasks([TASK], ME_READ_ONLY);
    await screen.findByText("Call seller");
    // a11y F-1: aria-disabled, not native `disabled` — the controls stay focusable so the
    // reason below is reachable by keyboard (the dedicated a11y describe block proves it).
    expect(screen.getByRole("checkbox", { name: /mark "call seller" done/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /add a task/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: /^delete/i })).toBeNull();
    // PRN-14 / disable-don't-hide: the reason is WORDS, not just a dimmed control.
    expect(screen.getAllByText("Your role can't edit tasks.").length).toBeGreaterThan(0);
    // Content is unaffected — reads gate on leads.read, and the identity still renders.
    expect(screen.getByText("You")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("C-11/ADR-0047: the portal host's canWrite overrides the capability gate (a partner holds none)", async () => {
    // capabilitiesOf() returns [] for the partner stream, so gating the portal panel on
    // work.write would make a partner's own tasks read-only. The portal passes canWrite.
    const partnerMe = { ...ME, role: "partner" as const, capabilities: [] as string[] };
    renderTasks([TASK], partnerMe, { canWrite: true });
    await screen.findByText("Call seller");
    expect(screen.getByRole("checkbox", { name: /mark "call seller" done/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /add a task/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^delete "call seller"$/i })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

// ── a11y F-1 / F-2: the read-only reason must be reachable by keyboard ──────────
// A natively `disabled` control leaves the tab order, so a keyboard-only user could never
// reach the tooltip explaining why the panel is inert. The standing permission miss is
// therefore aria-disabled + a swallowed activation, and the tooltip id is wired to the
// CONTROL rather than the label wrapping it.
describe("C-11/DSN-03: the read-only reason is keyboard-reachable (a11y F-1/F-2)", () => {
  const renderReadOnly = (tasks: LeadTask[] = [TASK]) => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tasks })) as unknown as typeof fetch);
    return wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />, ME_READ_ONLY);
  };

  it("C-11/a11y F-1: the read-only checkbox and add-trigger stay in the tab order, marked aria-disabled", async () => {
    const user = userEvent.setup();
    renderReadOnly();
    await screen.findByText("Call seller");

    const checkbox = screen.getByRole("checkbox", { name: /mark "call seller" done/i });
    const addTrigger = screen.getByRole("button", { name: /add a task/i });
    // Inert, but ANNOUNCED as inert rather than removed from the AT tree.
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
    expect(addTrigger).toHaveAttribute("aria-disabled", "true");
    // Still reachable: `disabled` would make these unfocusable and the reason unreadable.
    expect(checkbox).not.toBeDisabled();
    expect(addTrigger).not.toBeDisabled();
    await user.tab();
    expect(checkbox).toHaveFocus();

    vi.unstubAllGlobals();
  });

  it("C-11/a11y F-1: activating either read-only control does nothing (no PATCH, no add form)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(() => jsonRes({ tasks: [TASK] }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />, ME_READ_ONLY);
    await screen.findByText("Call seller");

    const checkbox = screen.getByRole("checkbox", { name: /mark "call seller" done/i });
    await user.click(checkbox);
    // Keyboard activation is blocked at the same seam (one controlled callback).
    checkbox.focus();
    await user.keyboard(" ");
    expect(checkbox).not.toBeChecked();
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PATCH" }));

    await user.click(screen.getByRole("button", { name: /add a task/i }));
    expect(screen.queryByLabelText(/task title/i)).toBeNull();

    vi.unstubAllGlobals();
  });

  it("C-11/a11y F-2: aria-describedby resolves to the reason, on the CONTROL not its label", async () => {
    renderReadOnly();
    await screen.findByText("Call seller");

    const checkbox = screen.getByRole("checkbox", { name: /mark "call seller" done/i });
    const describedBy = checkbox.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Your role can't edit tasks.");
    // The 44px label hit-area is NOT the described element — a screen reader focuses the box.
    expect(checkbox.closest("label")).not.toHaveAttribute("aria-describedby");

    const addTrigger = screen.getByRole("button", { name: /add a task/i });
    const addDescribedBy = addTrigger.getAttribute("aria-describedby");
    expect(document.getElementById(addDescribedBy!)?.textContent).toBe("Your role can't edit tasks.");

    vi.unstubAllGlobals();
  });

  it("C-11/a11y F-1: a writable panel adds neither aria-disabled nor a description", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tasks: [TASK] })) as unknown as typeof fetch);
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />, ME);
    await screen.findByText("Call seller");

    const checkbox = screen.getByRole("checkbox", { name: /mark "call seller" done/i });
    expect(checkbox).not.toHaveAttribute("aria-disabled");
    expect(checkbox).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("button", { name: /add a task/i })).not.toHaveAttribute("aria-disabled");

    vi.unstubAllGlobals();
  });
});

// ── TSK-13 (C-46) / TSK-12: the pure picker + patch rules ───────────────────────
// The undefined-vs-null contract and the "Me" sentinel are the two places an edit UI can
// silently destroy data (a title-only edit wiping a due date, an unchanged form clearing an
// assignee). Both are pure functions, so they are pinned without a DOM.

const ROSTER: TaskAssignee[] = [
  { id: "u-casey", email: "casey@meridian.test", role: "admin" },
  { id: "u-dana", email: "dana@meridian.test", role: "member" },
];

describe("TSK-13: the assignee picker's option rules", () => {
  it("TSK-13: 'Me' comes first and the caller's own seat is never listed twice", () => {
    expect(assigneeOptions(ROSTER, ME.email)).toEqual([
      { value: ASSIGN_TO_ME, label: "Me" },
      { value: "u-dana", label: "dana" },
    ]);
  });

  it("TSK-13: while ['me'] is loading the caller's seat renders as an ordinary row, never a guessed 'Me'", () => {
    expect(assigneeOptions(ROSTER, undefined)).toEqual([
      { value: ASSIGN_TO_ME, label: "Me" },
      { value: "u-casey", label: "casey" },
      { value: "u-dana", label: "dana" },
    ]);
  });

  it("TSK-13/PRN-14: a shared local part falls back to the full address — identity is never ambiguous", () => {
    const clashing: TaskAssignee[] = [
      { id: "u-1", email: "dana@meridian.test", role: "member" },
      { id: "u-2", email: "dana@partner.test", role: "member" },
      { id: "u-3", email: "sam@meridian.test", role: "viewer" },
    ];
    expect(assigneeOptions(clashing, ME.email)).toEqual([
      { value: ASSIGN_TO_ME, label: "Me" },
      { value: "u-1", label: "dana@meridian.test" },
      { value: "u-2", label: "dana@partner.test" },
      { value: "u-3", label: "sam" },
    ]);
  });

  it("TSK-13: an empty roster still offers 'Me' (the picker never renders an empty dropdown)", () => {
    expect(assigneeOptions([], ME.email)).toEqual([{ value: ASSIGN_TO_ME, label: "Me" }]);
  });

  it("TSK-13/PRN-14 (design F-5): an assignee missing from the roster gets an option from the row's own identity", () => {
    // A seat deactivated since the assignment: the roster (active-only) no longer carries it,
    // so without this the Select would render BLANK on a task that IS assigned.
    const closedSeat = { ...COLLEAGUE, deactivated: true };
    expect(assigneeOptions(ROSTER, ME.email, { value: "u-gone", identity: closedSeat })).toEqual([
      { value: ASSIGN_TO_ME, label: "Me" },
      { value: "u-gone", label: "dana · deactivated" },
      { value: "u-dana", label: "dana" },
    ]);
    // An ACTIVE assignee the roster simply didn't return (a failed read) is labeled plainly.
    expect(assigneeOptions([], ME.email, { value: "u-dana", identity: COLLEAGUE })).toEqual([
      { value: ASSIGN_TO_ME, label: "Me" },
      { value: "u-dana", label: "dana" },
    ]);
  });

  it("TSK-13 (design F-5): the fallback never duplicates a roster row, and never fires for 'Me'", () => {
    // Already in the roster → no second entry.
    expect(assigneeOptions(ROSTER, ME.email, { value: "u-dana", identity: COLLEAGUE })).toEqual([
      { value: ASSIGN_TO_ME, label: "Me" },
      { value: "u-dana", label: "dana" },
    ]);
    // Self-assigned rows resolve to the sentinel, which always has an option.
    expect(assigneeOptions(ROSTER, ME.email, { value: ASSIGN_TO_ME, identity: MY_IDENTITY })).toEqual([
      { value: ASSIGN_TO_ME, label: "Me" },
      { value: "u-dana", label: "dana" },
    ]);
    // No resolvable identity → nothing truthful to render, so no invented option.
    expect(assigneeOptions([], ME.email, { value: "u-ghost", identity: null })).toEqual([
      { value: ASSIGN_TO_ME, label: "Me" },
    ]);
  });

  it("TSK-12/TSK-03: a self-assigned row starts on 'Me'; a colleague's row starts on their id", () => {
    expect(initialAssigneeValue({ assignedToUserId: "u1", assignee: MY_IDENTITY }, ME.email)).toBe(ASSIGN_TO_ME);
    expect(initialAssigneeValue({ assignedToUserId: "u2", assignee: COLLEAGUE }, ME.email)).toBe("u2");
    // Unassigned / unresolvable: "Me" — the server's own default-to-creator rule.
    expect(initialAssigneeValue({ assignedToUserId: null, assignee: null }, ME.email)).toBe(ASSIGN_TO_ME);
    expect(initialAssigneeValue({ assignedToUserId: "u3", assignee: null }, ME.email)).toBe(ASSIGN_TO_ME);
  });
});

describe("TSK-12: buildTaskPatch sends only changed fields", () => {
  const base = { title: "Call seller", dueOn: "2026-08-14" as string | null };

  it("TSK-12: an untouched form produces an EMPTY patch (the server's 'Nothing to change')", () => {
    expect(buildTaskPatch(base, { title: "Call seller", dueOn: "2026-08-14", assignee: ASSIGN_TO_ME }, ASSIGN_TO_ME)).toEqual({});
  });

  it("TSK-12: a title-only edit carries NO dueOn key at all — absent, not undefined", () => {
    const patch = buildTaskPatch(base, { title: "Call seller back", dueOn: "2026-08-14", assignee: ASSIGN_TO_ME }, ASSIGN_TO_ME);
    expect(patch).toEqual({ title: "Call seller back" });
    // The distinction that matters: a materialised `dueOn: undefined` key would read as
    // "clear" to a lax parser and wipe the date on a rename.
    expect(Object.keys(patch)).toEqual(["title"]);
    expect("dueOn" in patch).toBe(false);
    expect("assignedToUserId" in patch).toBe(false);
  });

  it("TSK-12: clearing the due date sends an explicit null", () => {
    expect(buildTaskPatch(base, { title: "Call seller", dueOn: null, assignee: ASSIGN_TO_ME }, ASSIGN_TO_ME)).toEqual({ dueOn: null });
  });

  it("TSK-12/TSK-03: reassigning to a colleague sends their id; back to 'Me' sends null", () => {
    expect(buildTaskPatch(base, { title: base.title, dueOn: base.dueOn, assignee: "u-dana" }, ASSIGN_TO_ME)).toEqual({
      assignedToUserId: "u-dana",
    });
    // Starting on a colleague and choosing "Me" reassigns to the caller — the server resolves
    // an explicit null back to the actor (TSK-03), so the client needs no id of its own.
    expect(buildTaskPatch(base, { title: base.title, dueOn: base.dueOn, assignee: ASSIGN_TO_ME }, "u-dana")).toEqual({
      assignedToUserId: null,
    });
  });

  it("TSK-12: the title is trimmed before comparison — whitespace alone is not a change", () => {
    expect(buildTaskPatch(base, { title: "  Call seller  ", dueOn: base.dueOn, assignee: ASSIGN_TO_ME }, ASSIGN_TO_ME)).toEqual({});
  });
});

// ── TSK-12: the inline edit form in the DOM ─────────────────────────────────────
describe("TSK-12: inline task edit", () => {
  /** GET lead tasks + GET the assignee roster + a PATCH handler the test supplies. */
  function stubFetch(tasks: LeadTask[], onPatch: (url: string, body: unknown) => unknown) {
    const spy = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return jsonRes(url === "/api/tasks/assignees" ? { assignees: ROSTER } : { tasks });
      if (method === "PATCH") return onPatch(url, JSON.parse((opts?.body as string) ?? "null"));
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", spy as unknown as typeof fetch);
    return spy;
  }
  const patchBody = (spy: ReturnType<typeof stubFetch>) => {
    const call = spy.mock.calls.find(([, o]) => (o as RequestInit | undefined)?.method === "PATCH");
    return JSON.parse((call?.[1] as RequestInit).body as string) as unknown;
  };

  it("TSK-12: the edit form pre-fills from the row and PATCHes only the changed field", async () => {
    const user = userEvent.setup();
    const spy = stubFetch([TASK], () => jsonRes({ code: "ok", message: "Task updated." }));
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");

    await user.click(screen.getByRole("button", { name: /^edit "call seller"$/i }));
    // Pre-filled: the title is the row's, and the due date reads back as the row's date.
    const titleInput = screen.getByLabelText(/task title/i);
    expect(titleInput).toHaveValue("Call seller");
    expect(screen.getByLabelText("Due date (optional)")).toHaveTextContent(/aug 14, 2026/i);
    // TSK-13: the picker defaults to "Me" — the row is self-assigned.
    expect(screen.getByLabelText(/assignee/i)).toHaveTextContent("Me");
    // Nothing changed yet, so Save is inert — and design F-2: it SAYS why, rather than
    // leaving the user staring at a dead button on a form that looks perfectly valid.
    expect(screen.getByRole("button", { name: /^save task$/i })).toBeDisabled();
    expect(screen.getByText("No changes to save.")).toBeInTheDocument();

    await user.clear(titleInput);
    await user.type(titleInput, "Call seller back");
    // …and the hint clears the moment there IS something to save.
    expect(screen.queryByText("No changes to save.")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^save task$/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("/api/tasks/t1", expect.objectContaining({ method: "PATCH" })));
    expect(patchBody(spy)).toEqual({ title: "Call seller back" });

    vi.unstubAllGlobals();
  });

  it("TSK-12: Clear on the due date sends an explicit null (and nothing else)", async () => {
    const user = userEvent.setup();
    const spy = stubFetch([TASK], () => jsonRes({ code: "ok", message: "Task updated." }));
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");

    await user.click(screen.getByRole("button", { name: /^edit "call seller"$/i }));
    await user.click(screen.getByRole("button", { name: /clear due date/i }));
    await user.click(screen.getByRole("button", { name: /^save task$/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("/api/tasks/t1", expect.objectContaining({ method: "PATCH" })));
    expect(patchBody(spy)).toEqual({ dueOn: null });

    vi.unstubAllGlobals();
  });

  it("TSK-12: focus returns to the row's Edit trigger on cancel AND on success", async () => {
    const user = userEvent.setup();
    stubFetch([TASK], () => jsonRes({ code: "ok", message: "Task updated." }));
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");

    const trigger = () => screen.getByRole("button", { name: /^edit "call seller"$/i });

    // Cancel: the form unmounts, so focus must land back on the control that opened it.
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(trigger()).toHaveFocus());

    // Success: same rule — the form goes away, focus comes home.
    await user.click(trigger());
    await user.type(screen.getByLabelText(/task title/i), " now");
    await user.click(screen.getByRole("button", { name: /^save task$/i }));
    await waitFor(() => expect(trigger()).toHaveFocus());

    vi.unstubAllGlobals();
  });

  it("TSK-12: a 409 task_closed rolls the row back and toasts (raced completion)", async () => {
    const user = userEvent.setup();
    stubFetch([TASK], () =>
      jsonRes({ code: "task_closed", message: "Task t1 is completed; reopen it before editing or deleting." }, false),
    );
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");

    await user.click(screen.getByRole("button", { name: /^edit "call seller"$/i }));
    await user.type(screen.getByLabelText(/task title/i), " urgently");
    await user.click(screen.getByRole("button", { name: /^save task$/i }));

    const toastStack = screen.getByTestId("toast-stack");
    expect(await within(toastStack).findByText(/reopen it before editing/i)).toBeInTheDocument();
    // Rolled back: the optimistic title never sticks.
    await waitFor(() => expect(screen.queryByText("Call seller urgently")).toBeNull());
    // The form stays open so the edit can be fixed rather than retyped.
    expect(screen.getByLabelText(/task title/i)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("TSK-12: a 400 invalid_assignee rolls back and toasts (stale roster)", async () => {
    const user = userEvent.setup();
    stubFetch([TASK], () =>
      jsonRes({ code: "invalid_assignee", message: "The assignee must be a member of your own team." }, false),
    );
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");

    await user.click(screen.getByRole("button", { name: /^edit "call seller"$/i }));
    await user.type(screen.getByLabelText(/task title/i), "!");
    await user.click(screen.getByRole("button", { name: /^save task$/i }));

    const toastStack = screen.getByTestId("toast-stack");
    expect(await within(toastStack).findByText(/member of your own team/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/task title/i)).toHaveValue("Call seller!"));

    vi.unstubAllGlobals();
  });

  it("TSK-13/PRN-14 (design F-5): an off-roster assignee renders truthfully, never as a blank picker", async () => {
    const user = userEvent.setup();
    // Assigned to a seat that has since been deactivated: C-11 still resolves its identity on
    // the row, but the ACTIVE-only roster no longer carries it.
    const closedSeat = { ...COLLEAGUE, deactivated: true };
    stubFetch([{ ...TASK, assignedToUserId: "u-gone", assignee: closedSeat }], () => jsonRes({}));
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");

    await user.click(screen.getByRole("button", { name: /^edit "call seller"$/i }));
    // The control states who holds the task — and that the seat is closed — instead of
    // reading as "unassigned" on a task that is assigned.
    await waitFor(() => expect(screen.getByLabelText(/assignee/i)).toHaveTextContent("dana · deactivated"));
    // Nothing was touched, so there is still nothing to save (the fallback is display-only).
    expect(screen.getByRole("button", { name: /^save task$/i })).toBeDisabled();
    expect(screen.getByText("No changes to save.")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("TSK-04: Edit is hidden on completed rows (a closed task is a permanent timeline fact)", async () => {
    stubFetch([{ ...TASK, doneAt: "2026-08-14T00:00:00.000Z" }], () => jsonRes({}));
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Call seller");
    expect(screen.queryByRole("button", { name: /^edit "call seller"$/i })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("TSK-12: Edit shows on a COLLEAGUE's open row — editing is stream-scoped, unlike Delete", async () => {
    stubFetch([{ ...TASK, title: "Their task", assignee: COLLEAGUE, author: COLLEAGUE }], () => jsonRes({}));
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText("Their task");
    expect(screen.getByRole("button", { name: /^edit "their task"$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete "their task"$/i })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("TSK-12/C-11: a read-only tier gets no Edit affordance at all", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tasks: [TASK] })) as unknown as typeof fetch);
    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />, ME_READ_ONLY);
    await screen.findByText("Call seller");
    expect(screen.queryByRole("button", { name: /^edit/i })).toBeNull();
    vi.unstubAllGlobals();
  });
});

// ── TSK-13: the picker in the add form ─────────────────────────────────────────
describe("TSK-13: the assignee picker in the add form", () => {
  it("TSK-13/TSK-03: the picker defaults to 'Me' and the POST OMITS assignedToUserId", async () => {
    const user = userEvent.setup();
    const spy = vi.fn((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      if (method === "GET") return jsonRes(url === "/api/tasks/assignees" ? { assignees: ROSTER } : { tasks: [] });
      if (method === "POST") return jsonRes({ id: "new-task" });
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", spy as unknown as typeof fetch);

    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText(/no tasks yet/i);
    await user.click(screen.getByRole("button", { name: /add a task/i }));

    // The roster is a SERVER read — the panel never derives the stream itself (PRN-13).
    await waitFor(() => expect(spy).toHaveBeenCalledWith("/api/tasks/assignees"));
    expect(screen.getByLabelText(/assignee/i)).toHaveTextContent("Me");

    await user.type(screen.getByLabelText(/task title/i), "Follow up");
    await user.click(screen.getByRole("button", { name: /^add task$/i }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("/api/leads/LD-26-00001/tasks", expect.objectContaining({ method: "POST" })),
    );
    const call = spy.mock.calls.find(([, o]) => (o as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>;
    // TSK-03: absent, not null and not a client-invented id — the server defaults to the creator.
    expect(body).toEqual({ title: "Follow up", dueOn: null });
    expect("assignedToUserId" in body).toBe(false);

    vi.unstubAllGlobals();
  });

  it("TSK-13/DSN-03 (design F-1): a FAILED roster read is an error state, not a loading one", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/api/tasks/assignees"
          ? jsonRes({ code: "assignees_failed", message: "Could not load your team." }, false)
          : jsonRes({ tasks: [] }),
      ) as unknown as typeof fetch,
    );

    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText(/no tasks yet/i);
    await user.click(screen.getByRole("button", { name: /add a task/i }));

    // PRN-14: an explanation, not just an empty dropdown…
    expect(await screen.findByText(/couldn't load your team/i)).toBeInTheDocument();
    const picker = screen.getByLabelText(/assignee/i);
    expect(picker).toHaveTextContent("Me");
    // …and a 500 must NOT render like a slow response: the control is marked invalid, and
    // the loading line is gone.
    await waitFor(() => expect(picker).toHaveAttribute("aria-invalid", "true"));
    expect(screen.queryByText(/loading your team/i)).toBeNull();
    // The form still works — the assignee simply stays the creator.
    expect(screen.getByRole("button", { name: /^add task$/i })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("TSK-13/DSN-03 (design F-1): a PENDING roster is a neutral hint with no invalid marking", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => (url === "/api/tasks/assignees" ? new Promise(() => {}) : jsonRes({ tasks: [] }))) as unknown as typeof fetch,
    );

    wrap(<TasksPanel leadRef="LD-26-00001" today="2026-08-15" />);
    await screen.findByText(/no tasks yet/i);
    await user.click(screen.getByRole("button", { name: /add a task/i }));

    expect(await screen.findByText(/loading your team/i)).toBeInTheDocument();
    const picker = screen.getByLabelText(/assignee/i);
    expect(picker).not.toHaveAttribute("aria-invalid");
    expect(picker).toBeDisabled();

    vi.unstubAllGlobals();
  });
});
