// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";
import { TasksPanel, type LeadTask } from "@/components/TasksPanel";

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

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
