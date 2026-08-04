// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalProfileMenu } from "@/components";

// T7a: the portal rail-foot account menu (the admin ProfileMenu pattern, portal-
// flavored). Radix portal content is only partially operable in jsdom (ws7-components
// precedent) — the open-menu assertions follow the same best-effort style.

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe("PortalProfileMenu", () => {
  it("T7a: opens with the portal destinations (Account / Devices / Terms), never admin ones", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ email: "partner@dev.test", role: "partner", workspace: { name: "W" } }) }) as Response),
    );
    wrap(<PortalProfileMenu />);
    await user.click(await screen.findByRole("button", { name: /Account menu/ }));
    expect(await screen.findByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "/portal");
    expect(screen.getByRole("menuitem", { name: "Devices" })).toHaveAttribute("href", "/portal/devices");
    expect(screen.getByRole("menuitem", { name: "Terms of service" })).toHaveAttribute("href", "/portal/tos");
    // Portal menu never links into the admin app.
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("Help & guides")).toBeNull();
  });

  it("AUT-14: sign out posts a local logout and navigates to the portal login", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true, configurable: true });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (String(url).includes("/api/me")) {
        return { ok: true, status: 200, json: async () => ({ email: "partner@dev.test", role: "partner", workspace: { name: "W" } }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ code: "ok" }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    wrap(<PortalProfileMenu />);
    await user.click(await screen.findByRole("button", { name: /Account menu/ }));
    await user.click(await screen.findByText("Sign out"));

    await waitFor(() => {
      const logout = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/auth/logout"));
      expect(logout).toBeTruthy();
      expect(String(logout?.[1]?.body)).toContain("local");
      expect(assign).toHaveBeenCalledWith("/portal/login");
    });
  });
});
