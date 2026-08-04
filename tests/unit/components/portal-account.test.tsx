// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/csrf-client", () => ({ csrfHeaders: () => ({}) }));

import { PortalAccount } from "@/app/portal/portal-account";

const assign = vi.fn();

// WP-PW-4 Task 2: PortalAccount now calls useIsDesktop() (src/lib/use-media-query.ts,
// window.matchMedia + useSyncExternalStore) as its unconditional desktop/mobile gate,
// which jsdom does not implement by default. Stub it (matches=false -> mobile, i.e. the
// AccountMobile body this test exercises) so the hook resolves instead of throwing.
beforeEach(() => {
  assign.mockReset();
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function renderAccount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PortalAccount />
    </QueryClientProvider>,
  );
}

describe("PortalAccount", () => {
  it("AUT-14: signing out POSTs the server logout then navigates to /portal/login", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ email: "p@x.co", role: "partner", workspace: { name: "Acme" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAccount();

    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      const logout = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/auth/logout"));
      expect(logout).toBeTruthy();
      expect(logout?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
      expect(String(logout?.[1]?.body)).toBe(JSON.stringify({ scope: "local" }));
    });
    expect(assign).toHaveBeenCalledWith("/portal/login");
  });
});
