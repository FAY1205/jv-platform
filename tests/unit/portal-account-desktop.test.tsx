// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-PW-4 Task 2: the desktop (>= lg) Account two-column grid (Profile + Devices).
// Renders AccountDesktop directly (not through the PortalAccount gate) so the test
// proves the grid component itself mounts both children and preserves AUT-14 on both
// sign-out paths (account sign-out + per-device revoke).

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({}) }));

const ME = { email: "p@x.co", role: "partner", workspace: { name: "Acme" } };
const SESSIONS = {
  devices: [
    {
      familyId: "fam-1",
      deviceLabel: "Chrome on Mac",
      ip: "1.2.3.4",
      createdAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: "2026-07-10T00:00:00.000Z",
    },
  ],
};

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn((url: string) => {
    if (url === "/api/me") return Promise.resolve(ME);
    if (url === "/api/sessions") return Promise.resolve(SESSIONS);
    return Promise.reject(new Error(`unexpected apiGet url: ${url}`));
  }),
}));

import { AccountDesktop } from "@/app/portal/account-desktop";

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
});

function renderDesktop() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccountDesktop />
    </QueryClientProvider>,
  );
}

describe("WP-PW-4 Task 2 AccountDesktop (two-column Profile + Devices grid)", () => {
  it("PW4-04: renders both the profile email and a device row (proves the two-column grid mounts both)", async () => {
    renderDesktop();
    expect(await screen.findByText("p@x.co")).toBeTruthy();
    expect(screen.getByText("Chrome on Mac")).toBeTruthy();
  });

  it("PW4-05 + P-12: per-device Sign out now confirms first (no revoke on the initial click)", async () => {
    // P-12: the per-device revoke mirrors the admin two-step — the first click reveals a
    // confirm, and only "Yes, sign out" fires the revoke (a stray click can't sign a device
    // out). The revoke Button carries a unique aria-label so it's disambiguated from the
    // account-level Sign out button (WCAG 2.4.6 / 4.1.2).
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderDesktop();

    await screen.findByText("Chrome on Mac");
    await user.click(screen.getByRole("button", { name: "Sign out Chrome on Mac" }));

    // The first click only reveals the confirm — no revoke request yet.
    expect(await screen.findByText("Sign out this device?")).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/revoke"))).toBe(false);

    // Confirming fires the revoke for that device.
    await user.click(screen.getByRole("button", { name: "Confirm sign out Chrome on Mac" }));
    await waitFor(() => {
      const revoke = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/sessions/fam-1/revoke"));
      expect(revoke).toBeTruthy();
    });
  });

  it("PW4-06: clicking the account Sign out POSTs logout then navigates to /portal/login", async () => {
    // WP-PW-4 Task 2 fix-1: the account-level Sign out Button now carries
    // aria-label="Sign out of your account" — query by that name.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderDesktop();

    await screen.findByText("p@x.co");
    const accountButton = screen.getByRole("button", { name: "Sign out of your account" });
    await user.click(accountButton);

    await waitFor(() => {
      const logout = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/auth/logout"));
      expect(logout).toBeTruthy();
      expect(logout?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
      expect(String(logout?.[1]?.body)).toBe(JSON.stringify({ scope: "local" }));
    });
    expect(assign).toHaveBeenCalledWith("/portal/login");
  });
});
