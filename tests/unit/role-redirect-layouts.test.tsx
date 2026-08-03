import { describe, it, expect, vi, beforeEach } from "vitest";

// Parity #4 role redirects: a partner navigating to any admin page gets sent to
// their portal (never the broken admin shell over 403 data), and an authenticated
// admin landing on a /portal page gets sent to the admin dashboard. Signed-out
// visitors are untouched — the proxy owns the login redirect.

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    // Mirror next/navigation: redirect() throws, it never returns.
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${to}` });
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

const getServerScope = vi.hoisted(() => vi.fn());
vi.mock("@/lib/scope-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scope-context")>();
  return { ...actual, getServerScope };
});

// The portal layout renders the client PortalShell; stub it so the server layout
// can be exercised without a jsdom mount.
vi.mock("@/components", () => ({ PortalShell: ({ children }: { children: React.ReactNode }) => children }));

import AdminLayout from "@/app/(admin)/layout";
import PortalLayout from "@/app/portal/layout";
import { UnauthenticatedError } from "@/lib/scope-context";

const partnerScope = { tenantId: "t1", role: "partner" as const, userId: "u1", partnerId: "p1" };
const adminScope = { tenantId: "t1", role: "admin" as const, userId: "u2" };

beforeEach(() => {
  redirect.mockClear();
  getServerScope.mockReset();
});

describe("admin (admin)/layout role gate", () => {
  it("redirects a partner to /portal/dashboard", async () => {
    getServerScope.mockResolvedValue(partnerScope);
    await expect(AdminLayout({ children: null })).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    expect(redirect).toHaveBeenCalledWith("/portal/dashboard");
  });

  it("renders for an admin (no redirect)", async () => {
    getServerScope.mockResolvedValue(adminScope);
    await AdminLayout({ children: null });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders for a signed-out visitor — the proxy owns the login redirect", async () => {
    getServerScope.mockRejectedValue(new UnauthenticatedError());
    await AdminLayout({ children: null });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("portal layout role gate", () => {
  it("redirects an authenticated admin to /dashboard", async () => {
    getServerScope.mockResolvedValue(adminScope);
    await expect(PortalLayout({ children: null })).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders for a partner (no redirect)", async () => {
    getServerScope.mockResolvedValue(partnerScope);
    await PortalLayout({ children: null });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders for a signed-out visitor (the /portal/login page must stay reachable)", async () => {
    getServerScope.mockRejectedValue(new UnauthenticatedError());
    await PortalLayout({ children: null });
    expect(redirect).not.toHaveBeenCalled();
  });
});
