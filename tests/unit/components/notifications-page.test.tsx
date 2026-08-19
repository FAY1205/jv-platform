// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationBell, NotificationsPage, ToastProvider } from "@/components";

// WP-NF2 PR C (NTF-12 / NTF-15): the shared /notifications page, mounted identically by the
// admin and the portal. What is worth pinning here is everything the bell does NOT do:
//
//  • the keyset "Load more" walk — that the button sends the server's own nextCursor back and
//    APPENDS rather than replacing, and that it disappears at the end of the feed;
//  • the optimistic mark-read against the INFINITE cache shape (a flat-cache patch would throw
//    here, and a rollback that forgot the unread count would leave the header lying);
//  • the full component-state matrix (skeleton → error+retry → empty);
//  • the NTF-15 preferences card: catalog-driven rows, and a PUT that carries exactly what the
//    reader can see on screen.
//
// Discriminating trick borrowed from the bell suite: after a mutation the refetch is left
// UNRESOLVED, so whatever the UI shows came from the optimistic write or its rollback and never
// from a server re-read that happens to agree.

// Radix (Checkbox/Switch focus plumbing) needs the observer APIs jsdom lacks.
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

const DAY_1 = "2026-08-18T09:30:00.000Z";
const DAY_2 = "2026-08-17T09:30:00.000Z";

const notif = (n: number, over: Partial<Record<string, unknown>> = {}) => ({
  id: `0000000${n}-1111-4111-8111-111111111111`,
  type: "status_change",
  title: `Notification ${n}`,
  body: null,
  deepLink: null,
  readAt: null,
  createdAt: DAY_1,
  ...over,
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface Routes {
  /** Handles a GET; return null to fall through to a never-settling promise. */
  get?: (url: string, call: number) => Response | Promise<Response> | null;
  post?: (url: string) => Response | Promise<Response>;
  put?: (url: string, body: unknown) => Response | Promise<Response>;
}

function stubFetch(routes: Routes) {
  let gets = 0;
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      gets++;
      return routes.get?.(url, gets) ?? new Promise<Response>(() => {});
    }
    if (method === "PUT") return routes.put!(url, init?.body ? JSON.parse(String(init.body)) : undefined);
    return routes.post!(url);
  });
  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NotificationsPage feed (NTF-12)", () => {
  it("NTF-12: renders the feed day-grouped with the unread line and no Load more at the end", async () => {
    stubFetch({
      get: (url, call) =>
        call === 1
          ? ok({
              notifications: [notif(1), notif(2, { createdAt: DAY_2, readAt: DAY_2 })],
              unread: 1,
              nextCursor: null,
            })
          : null,
    });
    wrap(<NotificationsPage />);

    expect(await screen.findByText("Notification 1")).toBeInTheDocument();
    expect(screen.getByText("Notification 2")).toBeInTheDocument();
    // Two calendar days → two group headings (groupByDay), not one flat list.
    expect(screen.getAllByText(/^(Today|Yesterday|[A-Z][a-z]{2} \d+)$/).length).toBe(2);
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    // PRN-14: unread is a dot SHAPE plus sr-only TEXT — exactly one of the two rows is unread.
    expect(screen.getAllByText("Unread:")).toHaveLength(1);
    // nextCursor null ⇒ the feed ended; no dangling affordance.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("NTF-12: Load more sends the server's own cursor back and APPENDS the next page", async () => {
    const seen: string[] = [];
    stubFetch({
      get: (url, call) => {
        seen.push(url);
        if (call === 1) return ok({ notifications: [notif(1)], unread: 2, nextCursor: "CURSOR-1" });
        if (call === 2) return ok({ notifications: [notif(2)], unread: 2, nextCursor: null });
        return null;
      },
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);

    await screen.findByText("Notification 1");
    expect(seen[0]).toContain("limit=30");
    expect(seen[0]).not.toContain("cursor=");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    // APPENDED, not replaced — page one's row must survive.
    expect(await screen.findByText("Notification 2")).toBeInTheDocument();
    expect(screen.getByText("Notification 1")).toBeInTheDocument();
    expect(seen[1]).toContain("cursor=CURSOR-1");
    // The last page came back with no cursor, so the button retires.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
  });

  it("NTF-12: Load more shows a loading state and cannot be double-fired", async () => {
    const second = deferred<Response>();
    stubFetch({
      get: (_url, call) => {
        if (call === 1) return ok({ notifications: [notif(1)], unread: 1, nextCursor: "CURSOR-1" });
        if (call === 2) return second.promise;
        return null;
      },
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);
    await screen.findByText("Notification 1");

    const button = screen.getByRole("button", { name: "Load more" });
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());

    second.resolve(ok({ notifications: [notif(2)], unread: 1, nextCursor: null }));
    expect(await screen.findByText("Notification 2")).toBeInTheDocument();
  });

  it("NTF-12: marking a row read flips the row AND the unread line before the request settles", async () => {
    const post = deferred<Response>();
    stubFetch({
      get: (_url, call) => (call === 1 ? ok({ notifications: [notif(1)], unread: 1, nextCursor: null }) : null),
      post: () => post.promise,
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);

    await screen.findByText("Notification 1");
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    // No deepLink ⇒ the row is a button that marks itself read in place.
    await user.click(screen.getByRole("button", { name: /Notification 1/ }));

    // The POST is in flight and the refetch can never resolve — this IS the optimistic write.
    expect(await screen.findByText("No unread notifications")).toBeInTheDocument();
    expect(screen.queryByText("Unread:")).toBeNull();
    post.resolve(ok({ code: "ok" }));
  });

  it("NTF-12: a failed mark-read ROLLS BACK the row and the count together", async () => {
    const post = deferred<Response>();
    stubFetch({
      get: (_url, call) => (call === 1 ? ok({ notifications: [notif(1)], unread: 1, nextCursor: null }) : null),
      post: () => post.promise,
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);

    await screen.findByText("Notification 1");
    await user.click(screen.getByRole("button", { name: /Notification 1/ }));
    await screen.findByText("No unread notifications");

    // A non-2xx must THROW (a bare fetch resolves on 500 and would leave the row falsely read).
    post.resolve({ ok: false, status: 500, json: async () => ({ message: "boom" }) } as Response);

    // The refetch is deliberately unresolvable, so this is the rollback and not a re-read.
    expect(await screen.findByText("1 unread")).toBeInTheDocument();
    expect(screen.getByText("Unread:")).toBeInTheDocument();
  });

  it("NTF-12: Mark all read zeroes the header optimistically and is disabled once clear", async () => {
    const post = deferred<Response>();
    stubFetch({
      get: (_url, call) =>
        call === 1 ? ok({ notifications: [notif(1), notif(2)], unread: 2, nextCursor: null }) : null,
      post: () => post.promise,
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);

    await screen.findByText("2 unread");
    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    expect(await screen.findByText("No unread notifications")).toBeInTheDocument();
    expect(screen.queryByText("Unread:")).toBeNull();
    // Nothing left to do ⇒ the action is disabled rather than a silent no-op.
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled());
    post.resolve(ok({ code: "ok" }));
  });

  it("NTF-12: a deep-linked row is a LINK to its target (and marks itself read on the way)", async () => {
    const post = deferred<Response>();
    stubFetch({
      get: (_url, call) =>
        call === 1
          ? ok({ notifications: [notif(1, { deepLink: "/leads?open=LD-26-00001" })], unread: 1, nextCursor: null })
          : null,
      post: () => post.promise,
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);

    const link = await screen.findByRole("link", { name: /Notification 1/ });
    expect(link).toHaveAttribute("href", "/leads?open=LD-26-00001");
    await user.click(link);
    expect(await screen.findByText("No unread notifications")).toBeInTheDocument();
    post.resolve(ok({ code: "ok" }));
  });

  it("NTF-12: row timestamps carry a machine-readable <time dateTime> + absolute-time tooltip", async () => {
    stubFetch({
      get: (_url, call) => (call === 1 ? ok({ notifications: [notif(1)], unread: 1, nextCursor: null }) : null),
    });
    wrap(<NotificationsPage />);
    await screen.findByText("Notification 1");

    const time = document.querySelector(`time[datetime="${DAY_1}"]`);
    expect(time).not.toBeNull();
    expect(time!.textContent).toMatch(/ago|just now/);
    expect(time!.getAttribute("title")).toBe(new Date(DAY_1).toLocaleString());
    expect(time!.getAttribute("title")).not.toBe(DAY_1); // an actual rendering, not the raw ISO
  });

  it("F-21/UXQ-01: a failed load surfaces an honest error + Retry, never a masked 'all caught up'", async () => {
    let call = 0;
    stubFetch({
      get: () => {
        call++;
        return call === 1
          ? ({ ok: false, status: 500, json: async () => ({ message: "boom", traceId: "tr-1" }) } as Response)
          : ok({ notifications: [notif(1)], unread: 1, nextCursor: null });
      },
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);

    expect(await screen.findByText("Couldn't load notifications")).toBeInTheDocument();
    expect(screen.queryByText("You're all caught up.")).toBeNull();
    expect(screen.getByText(/tr-1/)).toBeInTheDocument(); // the traceId is reportable

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Notification 1")).toBeInTheDocument();
  });

  it("NTF-12: an empty feed shows the caught-up state and a disabled Mark all read", async () => {
    stubFetch({ get: (_url, call) => (call === 1 ? ok({ notifications: [], unread: 0, nextCursor: null }) : null) });
    wrap(<NotificationsPage />);
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("NTF-12: the pending state is skeletons — never an empty state that later fills in", async () => {
    stubFetch({ get: () => null }); // never settles
    const { container } = wrap(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText("Loading your notifications…")).toBeInTheDocument());
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("You're all caught up.")).toBeNull();
  });
});

describe("NotificationsPage preferences (NTF-15)", () => {
  const PREFS = {
    role: "partner" as const,
    allEmailsOff: false,
    events: [
      { key: "new_leads", label: "New leads assigned to you", effective: { email: true, inApp: true }, overridden: { email: false, inApp: false } },
      { key: "task_due", label: "A task is due", effective: { email: false, inApp: true }, overridden: { email: true, inApp: false } },
    ],
  };

  /** Feed + prefs wiring; the feed is trivial so the card is the only moving part. */
  function stubPrefs(put?: (url: string, body: unknown) => Response | Promise<Response>) {
    return stubFetch({
      get: (url) => {
        if (url.startsWith("/api/me/notification-prefs")) return ok(PREFS);
        return ok({ notifications: [], unread: 0, nextCursor: null });
      },
      put: put ?? ((_u, body) => ok({ ...PREFS, ...(body as object) })),
    });
  }

  it("NTF-15: the card is LAZY — no prefs request until Preferences is opened", async () => {
    const fetchMock = stubPrefs();
    const user = userEvent.setup();
    wrap(<NotificationsPage />);
    await screen.findByText("You're all caught up.");

    const prefsCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/me/notification-prefs"));
    expect(prefsCalls()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Preferences" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Preferences" }));
    expect(await screen.findByText("Your notification preferences")).toBeInTheDocument();
    await waitFor(() => expect(prefsCalls().length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Preferences" })).toHaveAttribute("aria-expanded", "true");
  });

  it("NTF-15: rows are CATALOG-DRIVEN — whatever the endpoint returns is what renders", async () => {
    stubPrefs();
    const user = userEvent.setup();
    wrap(<NotificationsPage />);
    await user.click(await screen.findByRole("button", { name: "Preferences" }));

    // Nothing is hardcoded in the component: both labels come from the payload, so PR B's new
    // types appear here without touching this file.
    expect(await screen.findByText("New leads assigned to you")).toBeInTheDocument();
    expect(screen.getByText("A task is due")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Email New leads assigned to you" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Email A task is due" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "In-app A task is due" })).toBeChecked();
  });

  it("NTF-15: Save PUTs the full events map for the caller's bucket plus allEmailsOff", async () => {
    let sent: unknown = null;
    stubPrefs((_u, body) => {
      sent = body;
      return ok({ ...PREFS, ...(body as object) });
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);
    await user.click(await screen.findByRole("button", { name: "Preferences" }));
    await screen.findByText("A task is due");

    await user.click(screen.getByRole("checkbox", { name: "Email A task is due" }));
    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toEqual({
      allEmailsOff: false,
      events: {
        new_leads: { email: true, inApp: true },
        task_due: { email: true, inApp: true }, // the leg just ticked
      },
    });
    // The toast renders twice by design (the visible row + the sr-only live region, R-56).
    expect((await screen.findAllByText("Notification preferences saved.")).length).toBeGreaterThan(0);
  });

  it("NTF-15: pausing all emails clears + disables the email column and NEVER touches in-app", async () => {
    let sent: unknown = null;
    stubPrefs((_u, body) => {
      sent = body;
      return ok({ ...PREFS, ...(body as object) });
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);
    await user.click(await screen.findByRole("button", { name: "Preferences" }));
    await screen.findByText("A task is due");

    await user.click(screen.getByRole("switch", { name: "Pause all notification emails" }));

    const email = screen.getByRole("checkbox", { name: "Email New leads assigned to you" });
    expect(email).not.toBeChecked();
    // STANDING inert, expressed with aria-disabled — NOT native `disabled`, which would drop the
    // box out of the tab order and take the explanation with it (Checkbox.tsx:15-25). jest-dom's
    // toBeDisabled() only sees the native attribute, so assert the aria state and then prove the
    // control is still reachable and still inert.
    expect(email).toHaveAttribute("aria-disabled", "true");
    expect(email).not.toBeDisabled();
    email.focus();
    expect(email).toHaveFocus(); // a keyboard user can still land on it and hear why
    await user.click(email);
    expect(email).not.toBeChecked(); // …and activation is swallowed
    // NTF-13 §10.7: the kill switch is EMAIL-only — unsubscribing must never blind the bell.
    expect(screen.getByRole("checkbox", { name: "In-app New leads assigned to you" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "In-app New leads assigned to you" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toEqual({
      allEmailsOff: true,
      events: {
        new_leads: { email: false, inApp: true },
        task_due: { email: false, inApp: true },
      },
    });
  });

  it("NTF-15: the card carries the always-sent security-email caveat (NTF-05)", async () => {
    stubPrefs();
    const user = userEvent.setup();
    wrap(<NotificationsPage />);
    await user.click(await screen.findByRole("button", { name: "Preferences" }));
    const card = (await screen.findByText("Your notification preferences")).closest("div.bg-surface")!;
    expect(within(card as HTMLElement).getByText(/always\s+sent/i)).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText(/off by\s+default/i)).toBeInTheDocument();
  });

  it("NTF-15: a failed prefs load is an honest error with Retry, not an empty grid", async () => {
    let call = 0;
    stubFetch({
      get: (url) => {
        if (!url.startsWith("/api/me/notification-prefs")) return ok({ notifications: [], unread: 0, nextCursor: null });
        call++;
        return call === 1
          ? ({ ok: false, status: 500, json: async () => ({ message: "prefs boom" }) } as Response)
          : ok(PREFS);
      },
    });
    const user = userEvent.setup();
    wrap(<NotificationsPage />);
    await user.click(await screen.findByRole("button", { name: "Preferences" }));

    expect(await screen.findByText("Couldn't load your preferences")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save preferences" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("A task is due")).toBeInTheDocument();
  });
});

describe("Bell and page reconciliation (NTF-12)", () => {
  // The two surfaces cache the SAME feed under two different keys in two different SHAPES (flat
  // vs. infinite). A mark-read on one must not leave the other showing a number the server no
  // longer agrees with — which is exactly what happens if either side forgets the other's key.
  // Mounted together under ONE QueryClient, as they are in the real shells.

  /** The bell's aria-live region — the honest read of what the badge believes. A `span`, so this
   *  never picks up the page's own <p aria-live> or the toast stack's <div>. */
  const bellLiveText = () => document.querySelector("span[aria-live='polite']")?.textContent ?? "";

  it("NTF-12: marking a row read ON THE PAGE updates the BELL badge once the write settles", async () => {
    let marked = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET").toUpperCase() !== "GET") {
          marked = true;
          return ok({ code: "ok" });
        }
        // Server truth flips only after the write, so a bell that reaches zero got there by
        // REFETCHING — it cannot have inherited the page's optimistic write, which lives under a
        // different key in a shape the bell cannot even read.
        const row = marked ? { ...notif(1), readAt: "2026-08-18T10:00:00.000Z" } : notif(1);
        return ok({ notifications: [row], unread: marked ? 0 : 1, nextCursor: null });
      }),
    );
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <NotificationBell />
          <NotificationsPage />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(bellLiveText()).toBe("1 unread notification"));
    // The bell's dropdown is closed, so this row button is unambiguously the PAGE's.
    await user.click(await screen.findByRole("button", { name: /Notification 1/ }));

    await waitFor(() => expect(screen.getByText("No unread notifications")).toBeInTheDocument());
    await waitFor(() => expect(bellLiveText()).toBe(""));
  });
});
