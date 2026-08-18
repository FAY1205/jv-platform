import { type NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { UnauthenticatedError, NotProvisionedError } from "@/lib/scope-context";
import type { ScopeContext } from "@/lib/scope";
import { csrfOk } from "./csrf";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-token";

// Route-level helpers shared by API handlers (WP-023/024a).

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * AUT-12 CSRF for state-changing routes: Origin allowlist plus, on authed routes,
 * the double-submit token (readable `__Host-jv-csrf` cookie echoed in `x-csrf-token`).
 * Pre-session routes (login) pass `requireToken: false` — Origin alone.
 */
export function assertCsrf(request: Request, opts: { requireToken: boolean }): boolean {
  const self = new URL(request.url).origin;
  return csrfOk({
    origin: request.headers.get("origin"),
    allowedOrigins: [self],
    requireToken: opts.requireToken,
    cookieToken: readCookie(request, CSRF_COOKIE_NAME),
    headerToken: request.headers.get(CSRF_HEADER_NAME) ?? undefined,
  });
}

/**
 * Map a scope-resolution failure to the uniform error envelope: 401 when there is
 * no session, 403 when authenticated without membership. Returns null for any
 * other error so the caller keeps its own 500 handling.
 */
export function authErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof UnauthenticatedError) {
    return jsonError("unauthenticated", "Authentication required.", 401);
  }
  if (e instanceof NotProvisionedError) {
    return jsonError("forbidden", e.message, 403);
  }
  return null;
}

/**
 * Admin-only gate for admin surfaces (dashboard/runs/uploads). Returns a 403
 * response when the scope is not an admin, else null. Partners share the tenant,
 * so tenant scoping alone does NOT separate them from admin routes.
 *
 * Phase C (WP-ROLE-1): this legacy gate passes ONLY the `admin` tier — the new
 * admin-stream tiers (`member`/`viewer`) 403 on every route still using it, which is
 * fail-closed by construction: an un-migrated route can never over-grant a new role.
 * @deprecated for NEW routes — use `requireCapabilityResponse(scope, cap)` from
 * `@/lib/authz` with the route's cluster capability instead. Existing call sites
 * migrate cluster-by-cluster (WP-ROLE-2/3).
 */
export function requireAdminResponse(scope: ScopeContext): NextResponse | null {
  return scope.role === "admin" ? null : jsonError("forbidden", "Admin access required.", 403);
}
