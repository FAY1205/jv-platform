// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components";
import NotificationSettingsPage from "@/app/(admin)/settings/notifications/page";

// ─────────────────────────────────────────────────────────────────────────────
// WP-NF2b — Settings → Notifications is now MY notifications.
//
// It used to be the workspace matrix: a `settings.manage`-gated grid of role × event
// checkboxes read from /api/settings/notifications, deciding delivery for everyone. That
// layer is retired (owner decision 2026-08-20), so this suite pins the replacement:
//  • the page reads the UN-gated personal endpoint, so a member or viewer seat can use it;
//  • it never touches the retired workspace route;
//  • it is the SAME card the portal renders (one editor, two mounts) — including the
//    email-only kill switch, which is where a forked copy would drift first.
// ─────────────────────────────────────────────────────────────────────────────

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

const PREFS = {
  role: "admin" as const,
  allEmailsOff: false,
  events: [
    { key: "run_summary", label: "Run summary after each upload", effective: { email: true, inApp: true }, overridden: { email: false, inApp: false } },
    { key: "partner_note", label: "A partner adds a note to a lead", effective: { email: false, inApp: true }, overridden: { email: false, inApp: false } },
  ],
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

function stubFetch(put?: (body: unknown) => Response) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET").toUpperCase() === "PUT") {
      return put ? put(init?.body ? JSON.parse(String(init.body)) : undefined) : ok(PREFS);
    }
    return ok(PREFS);
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

describe("Settings → Notifications (WP-NF2b)", () => {
  it("WP-NF2b: reads the caller's OWN preferences, never the retired workspace matrix", async () => {
    const fetchMock = stubFetch();
    wrap(<NotificationSettingsPage />);

    expect(await screen.findByText("Run summary after each upload")).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.every((u) => u.startsWith("/api/me/notification-prefs"))).toBe(true);
    // The route is gone; a page still calling it would 404 in prod and pass a lax stub here.
    expect(urls.some((u) => u.includes("/api/settings/notifications"))).toBe(false);
  });

  it("WP-NF2b: the copy says these settings are the reader's own, not the workspace's", async () => {
    stubFetch();
    wrap(<NotificationSettingsPage />);
    await screen.findByText("Run summary after each upload");
    // The old page's promise ("choose how each alert is delivered" — for everyone) is exactly
    // the misunderstanding this page must no longer create.
    expect(screen.getByText(/yours alone/i)).toBeInTheDocument();
    // NTF-05: stated by the section header AND inside the card — both are legitimate.
    expect(screen.getAllByText(/always sent/i).length).toBeGreaterThan(0);
  });

  it("WP-NF2b: it is the SAME card the portal mounts — catalog rows + the email-only kill switch", async () => {
    let sent: unknown = null;
    stubFetch((body) => {
      sent = body;
      return ok(PREFS);
    });
    const user = userEvent.setup();
    wrap(<NotificationSettingsPage />);
    await screen.findByText("A partner adds a note to a lead");

    // Rows are catalog-driven (both labels come from the payload, nothing hardcoded here).
    expect(screen.getByRole("checkbox", { name: "Email Run summary after each upload" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Email A partner adds a note to a lead" })).not.toBeChecked();

    // NTF-13 §10.7: pausing email clears the email column and leaves every in-app leg alone.
    await user.click(screen.getByRole("switch", { name: "Pause all notification emails" }));
    expect(screen.getByRole("checkbox", { name: "In-app Run summary after each upload" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toEqual({
      allEmailsOff: true,
      events: {
        run_summary: { email: false, inApp: true },
        partner_note: { email: false, inApp: true },
      },
    });
  });
});
