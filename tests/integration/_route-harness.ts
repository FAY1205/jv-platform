import { randomUUID } from "node:crypto";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, newCsrfToken } from "@/lib/auth/csrf-token";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";

// ─────────────────────────────────────────────────────────────────────────────
// Reusable harness for HTTP-level route-handler tests (integration tier).
//
// A Next.js API route handler resolves the caller's scope with getServerScope()
// (cookies via next/headers + a verified Supabase session) and guards state
// changes with assertCsrf() before it ever touches the DB. This harness supplies
// both without a live Supabase session, so a route test can drive the real
// handler + command + DB and assert the HTTP contract (status + error envelope):
//
//   • Scope is injected at the getServerScope seam (setRouteScope / scopeContextMock).
//     Cookie→scope resolution has its own coverage (tests/unit/scope-context), so a
//     route test just declares "who is calling" rather than re-plumbing auth here.
//   • CSRF is satisfied for real — jsonRequest() builds a matching Origin plus a
//     double-submit token pair — so the route's own assertCsrf runs UNMOCKED.
//   • The DB stays live (getDb), so handlers exercise real queries/commands. Suites
//     that use this self-skip without DATABASE_URL, like the rest of the tier.
// ─────────────────────────────────────────────────────────────────────────────

/** The app origin every harnessed request declares; also what assertCsrf derives
 *  `self` from (request.url), so Origin and URL must share it. */
export const APP_ORIGIN = "http://localhost:3000";

/** Mutable holder the getServerScope mock reads. Set per-suite via setRouteScope. */
export const routeScope: { current: ScopeContext | null } = { current: null };

/**
 * Factory body for `vi.mock("@/lib/scope-context", …)`. Overrides ONLY
 * getServerScope; every other export is preserved (guard.ts imports the error
 * classes; scope-context's own tests import resolveScope). An unset scope throws
 * UnauthenticatedError, mirroring the real "no session" path (401).
 */
export function scopeContextMock(
  actual: typeof ScopeContextModule,
): typeof ScopeContextModule {
  return {
    ...actual,
    getServerScope: async (): Promise<ScopeContext> => {
      if (!routeScope.current) throw new actual.UnauthenticatedError();
      return routeScope.current;
    },
  };
}

/** Declare the authenticated caller for subsequent route invocations. */
export function setRouteScope(scope: ScopeContext | null): void {
  routeScope.current = scope;
}

/** A ready-made admin scope for a tenant (userId defaults to a fresh uuid). */
export function adminScope(tenantId: string, userId = randomUUID()): ScopeContext {
  return { tenantId, role: "admin", userId };
}

/**
 * Build a CSRF-valid JSON Request for a state-changing route: matching Origin +
 * a double-submit token echoed in both the `__Host-jv-csrf` cookie and the
 * `x-csrf-token` header. `path` is app-absolute, e.g. "/api/leads/LD-26-90001".
 */
export function jsonRequest(method: string, path: string, body?: unknown): Request {
  const token = newCsrfToken();
  const headers: Record<string, string> = {
    origin: APP_ORIGIN,
    cookie: `${CSRF_COOKIE_NAME}=${token}`,
    [CSRF_HEADER_NAME]: token,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** App Router dynamic-route context: params arrive as a Promise (Next 15). */
export function routeParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}
