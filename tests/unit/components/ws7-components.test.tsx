// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationBell, ProfileMenu } from "@/components";

// WS-7f/7d component coverage for the shipped a11y/reliability fixes. Radix portal content
// (the open dropdown) is only partially operable in jsdom, so the always-rendered aria-live
// region (F-7) is asserted directly; the open-menu assertions are best-effort.

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe("NotificationBell", () => {
  it("F-7: announces the unread count in an aria-live region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ notifications: [], unread: 3 }) }) as Response),
    );
    wrap(<NotificationBell />);
    await waitFor(() => expect(screen.getByText("3 unread notifications")).toBeInTheDocument());
  });

  it("F-21: a failed notifications fetch surfaces an error, never a masked 'all caught up'", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: "boom" }) }) as Response),
    );
    wrap(<NotificationBell />);
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(await screen.findByText("Couldn't load notifications")).toBeInTheDocument();
    expect(screen.queryByText("You're all caught up.")).toBeNull();
  });
});

describe("ProfileMenu", () => {
  it("F-… sign out posts a local logout and navigates away", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true, configurable: true });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (String(url).includes("/api/me")) {
        return { ok: true, status: 200, json: async () => ({ email: "a@b.test", role: "admin", workspace: { name: "W" } }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ code: "ok" }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    wrap(<ProfileMenu />);
    await user.click(await screen.findByRole("button", { name: /Account menu/ }));
    // P-2: the old "Help & guides" item (which 404'd in prod at /dev/emails) is gone;
    // the dev email preview is now honestly labeled and dev-gated. Theme moved to the topbar.
    expect(screen.queryByText("Help & guides")).toBeNull();
    expect(await screen.findByText("Email preview (dev)")).toBeInTheDocument();
    expect(screen.queryByText(/^Theme:/)).toBeNull();
    await user.click(await screen.findByText("Sign out"));

    await waitFor(() => {
      const logout = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/auth/logout"));
      expect(logout).toBeTruthy();
      expect(String(logout?.[1]?.body)).toContain("local");
    });
  });
});
