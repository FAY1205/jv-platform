// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationBell } from "@/components";

// WP-NF1 D8 (NTF-04): the notification centre's read-marking is OPTIMISTIC. Invalidate-only
// meant the dot, the row tint and the badge count all lagged a network round-trip behind the
// click — on a slow link that reads as "nothing happened" and invites a second click.
//
// The discriminating trick used throughout: the refetch that onSettled triggers is left
// UNRESOLVED, so whatever the UI shows after a failed mutation came from the ROLLBACK and not
// from a server re-read that happens to agree.

// Radix DropdownMenu needs the pointer/observer APIs jsdom lacks.
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

const CREATED_AT = "2026-08-18T09:30:00.000Z";
const UNREAD = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "task_due",
  title: "Task due: Chase the survey paperwork",
  body: "Lead LD-26-30001 — overdue since 2026-08-17.",
  deepLink: null,
  readAt: null,
  createdAt: CREATED_AT,
};
const READ = {
  id: "22222222-2222-4222-8222-222222222222",
  type: "run_summary",
  title: "Import IM-26-014 processed",
  body: null,
  deepLink: null,
  readAt: "2026-08-18T10:00:00.000Z",
  createdAt: "2026-08-18T08:00:00.000Z",
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

/** A promise plus its resolver, so a test can hold a request in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Wire the two endpoints the bell talks to.
 * - GET #1 returns `feed`; every LATER GET returns a promise that never settles, so the
 *   post-mutation UI state is unambiguously the optimistic write or its rollback.
 * - POST returns whatever `post` yields (a deferred, so the test controls the timing).
 */
function stubFetch(feed: { notifications: unknown[]; unread: number }, post: () => Promise<Response>) {
  let gets = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init || (init.method ?? "GET") === "GET") {
      gets++;
      return gets === 1 ? ok(feed) : new Promise<Response>(() => {});
    }
    return post();
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** The aria-live region is the honest read of "how many unread does the UI believe there are". */
const liveText = () => document.querySelector("span[aria-live='polite']")?.textContent ?? "";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NotificationBell (NTF-04)", () => {
  it("NTF-04: marking one read flips the row + badge BEFORE the request settles", async () => {
    const user = userEvent.setup();
    const post = deferred<Response>();
    stubFetch({ notifications: [UNREAD, READ], unread: 1 }, () => post.promise);

    wrap(<NotificationBell />);
    await waitFor(() => expect(liveText()).toBe("1 unread notification"));
    await user.click(screen.getByRole("button", { name: /Notifications/ }));

    const row = await screen.findByText(UNREAD.title);
    // PRN-14: "unread" is carried by a dot SHAPE plus sr-only TEXT, never by the tint alone.
    expect(screen.getByText("Unread:")).toBeInTheDocument();
    await user.click(row);

    // The POST is still in flight and the refetch can never resolve — this is the optimistic write.
    await waitFor(() => expect(liveText()).toBe(""));
    expect(screen.queryByText("Unread:")).toBeNull();

    post.resolve(ok({ code: "ok" }));
    await waitFor(() => expect(liveText()).toBe(""));
  });

  it("NTF-04: a failed mark-read ROLLS BACK — the row goes back to unread", async () => {
    const user = userEvent.setup();
    const post = deferred<Response>();
    stubFetch({ notifications: [UNREAD, READ], unread: 1 }, () => post.promise);

    wrap(<NotificationBell />);
    await waitFor(() => expect(liveText()).toBe("1 unread notification"));
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    await user.click(await screen.findByText(UNREAD.title));
    await waitFor(() => expect(liveText()).toBe("")); // optimistically read…

    // A non-2xx must THROW (a bare fetch resolves on 500 and would leave the row falsely read).
    post.resolve({ ok: false, status: 500, json: async () => ({ message: "boom" }) } as Response);

    // …and back to unread. The refetch is deliberately unresolvable, so this IS the rollback.
    await waitFor(() => expect(liveText()).toBe("1 unread notification"));
    expect(await screen.findByText("Unread:")).toBeInTheDocument();
  });

  it("NTF-04: mark-all-read zeroes the badge optimistically and rolls back on failure", async () => {
    const user = userEvent.setup();
    const post = deferred<Response>();
    stubFetch({ notifications: [UNREAD, { ...READ, readAt: null }], unread: 2 }, () => post.promise);

    wrap(<NotificationBell />);
    await waitFor(() => expect(liveText()).toBe("2 unread notifications"));
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    await user.click(await screen.findByRole("button", { name: "Mark all read" }));

    await waitFor(() => expect(liveText()).toBe(""));
    post.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);
    await waitFor(() => expect(liveText()).toBe("2 unread notifications"));
  });

  it("NTF-04: an already-read row never decrements the unread count", async () => {
    // Clicking a read row must be inert: the count is the server's, and double-counting a
    // no-op read would drift the badge below the truth until the next refetch.
    const user = userEvent.setup();
    const post = deferred<Response>();
    stubFetch({ notifications: [UNREAD, READ], unread: 1 }, () => post.promise);

    wrap(<NotificationBell />);
    await waitFor(() => expect(liveText()).toBe("1 unread notification"));
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    await user.click(await screen.findByText(READ.title));

    // No mutation fires for a read row at all (the component guards the click), so the count holds.
    await new Promise((r) => setTimeout(r, 0));
    expect(liveText()).toBe("1 unread notification");
  });

  it("NTF-04: row timestamps carry a machine-readable <time dateTime> + absolute title", async () => {
    const user = userEvent.setup();
    stubFetch({ notifications: [UNREAD], unread: 1 }, async () => ok({ code: "ok" }));

    wrap(<NotificationBell />);
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    await screen.findByText(UNREAD.title);

    const time = document.querySelector(`time[datetime="${CREATED_AT}"]`);
    expect(time).not.toBeNull();
    // The relative string stays the visible text; the tooltip carries the full local instant.
    expect(time!.textContent).toMatch(/ago|just now/);
    expect(time!.getAttribute("title")).toBe(new Date(CREATED_AT).toLocaleString());
    expect(time!.getAttribute("title")).not.toBe(CREATED_AT); // an actual rendering, not the raw ISO
  });

  it("F-21: a failed load surfaces an error, never a masked 'all caught up'", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: "boom" }) }) as Response),
    );
    wrap(<NotificationBell />);
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(await screen.findByText("Couldn't load notifications")).toBeInTheDocument();
    expect(screen.queryByText("You're all caught up.")).toBeNull();
    // Nothing to mark read when nothing loaded.
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });

  it("NTF-04: an empty feed shows the caught-up state and no mark-all affordance", async () => {
    const user = userEvent.setup();
    stubFetch({ notifications: [], unread: 0 }, async () => ok({ code: "ok" }));
    wrap(<NotificationBell />);
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
    expect(liveText()).toBe(""); // nothing announced when there is nothing unread
  });
});
