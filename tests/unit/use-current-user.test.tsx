// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCurrentUser, type CurrentUser } from "@/lib/use-current-user";

// C-44 (audit finding, Slice-3 C-11 build): `canDo` reads the capability list off the cached
// /api/me payload. If that payload ever arrives WITHOUT `capabilities` — a stale cached
// response from before the Phase C contract, a partial body, plain contract drift — a bare
// `.includes()` throws straight out of render and blanks whatever surface asked. The gate is
// CHROME ONLY (lib/authz is authoritative on every route), so the only safe direction is to
// fail closed: hide the affordance, never take the page down with it.

const ME: CurrentUser = {
  email: "casey@meridian.test",
  role: "admin",
  capabilities: ["leads.read", "work.write"],
  workspace: { name: "Meridian" },
  isPlatformOwner: false,
};

/** Seed ["me"] with `payload` and render the hook. `undefined` leaves it unseeded (loading). */
function renderMe(payload?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (payload !== undefined) qc.setQueryData(["me"], payload);
  return renderHook(() => useCurrentUser(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("C-44: useCurrentUser.canDo fails closed", () => {
  it("C-44: a capabilities-less payload renders canDo=false without throwing", () => {
    // Every field of the contract EXCEPT `capabilities`.
    const { result } = renderMe({
      email: ME.email,
      role: "admin",
      workspace: { name: "Meridian" },
      isPlatformOwner: false,
    });
    expect(() => result.current.canDo("work.write")).not.toThrow();
    expect(result.current.canDo("work.write")).toBe(false);
    expect(result.current.canDo("leads.read")).toBe(false);
    // The rest of the payload is still usable — failing closed is not failing over.
    expect(result.current.data).toMatchObject({ email: ME.email });
  });

  it("C-44: an explicitly null capabilities list also fails closed", () => {
    const { result } = renderMe({ ...ME, capabilities: null });
    expect(result.current.canDo("work.write")).toBe(false);
  });

  it("C-44: canDo is false while ['me'] is still loading — affordances appear when identity does", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
    const { result } = renderMe();
    expect(result.current.canDo("work.write")).toBe(false);
  });

  it("C-44: a well-formed payload still grants exactly the capabilities it carries", () => {
    const { result } = renderMe(ME);
    expect(result.current.canDo("work.write")).toBe(true);
    expect(result.current.canDo("leads.read")).toBe(true);
    expect(result.current.canDo("team.manage")).toBe(false);
  });
});
