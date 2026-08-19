// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationBell } from "@/components";

// WP-NF2 PR C (NTF-12): the bell's handoff to the full /notifications page.
//
// Its own file so the pre-NF2 bell suite (tests/unit/components/notification-bell.test.tsx)
// stays byte-unmodified — the `viewAllHref` prop is additive and the panel without it must be
// exactly what shipped.
//
// The footer is asserted in EVERY state, because the states where it matters most (an empty or
// a failed panel) are precisely the ones a "render it with the list" implementation drops it in.

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

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "task_due",
  title: "Task due: chase the paperwork",
  body: null,
  deepLink: null,
  readAt: null,
  createdAt: "2026-08-18T09:30:00.000Z",
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Open the bell panel and hand back the "View all notifications" link, if any. */
async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Notifications/ }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NotificationBell view-all footer (NTF-12)", () => {
  it("NTF-12: with viewAllHref the panel gains a persistent footer link to the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ notifications: [ROW], unread: 1, nextCursor: null })));
    const user = userEvent.setup();
    wrap(<NotificationBell viewAllHref="/notifications" />);
    await openPanel(user);

    const link = await screen.findByRole("menuitem", { name: "View all notifications" });
    expect(link).toHaveAttribute("href", "/notifications");
  });

  it("NTF-12: the footer is present in the EMPTY state — where 'show me the rest' is most asked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ notifications: [], unread: 0, nextCursor: null })));
    const user = userEvent.setup();
    wrap(<NotificationBell viewAllHref="/portal/notifications" />);
    await openPanel(user);

    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
    expect(await screen.findByRole("menuitem", { name: "View all notifications" })).toHaveAttribute(
      "href",
      "/portal/notifications",
    );
  });

  it("NTF-12: the footer survives a FAILED load (the error state still offers a way forward)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: "boom" }) }) as Response),
    );
    const user = userEvent.setup();
    wrap(<NotificationBell viewAllHref="/notifications" />);
    await openPanel(user);

    expect(await screen.findByText("Couldn't load notifications")).toBeInTheDocument();
    expect(await screen.findByRole("menuitem", { name: "View all notifications" })).toBeInTheDocument();
  });

  it("NTF-12: WITHOUT the prop the panel is exactly the pre-NF2 one — no footer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ notifications: [ROW], unread: 1, nextCursor: null })));
    const user = userEvent.setup();
    wrap(<NotificationBell />);
    await openPanel(user);

    await screen.findByText(ROW.title);
    expect(screen.queryByText("View all notifications")).toBeNull();
  });

  it("NTF-12: the bell ignores the additive nextCursor field — it never pages", async () => {
    // The page and the bell share one endpoint; the bell must not start walking cursors just
    // because the response grew a field.
    const fetchMock = vi.fn(async () => ok({ notifications: [ROW], unread: 1, nextCursor: "CURSOR-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    wrap(<NotificationBell viewAllHref="/notifications" />);
    await openPanel(user);
    await screen.findByText(ROW.title);

    // Exactly one row rendered, and the bare URL — no `?cursor=` follow-up.
    expect(screen.getAllByText(ROW.title)).toHaveLength(1);
    for (const [url] of fetchMock.mock.calls as unknown as [string][]) {
      expect(String(url)).toBe("/api/notifications");
    }
  });
});
