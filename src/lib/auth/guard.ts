import { type NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { UnauthenticatedError, NotProvisionedError } from "@/lib/scope-context";
import type { ScopeContext } from "@/lib/scope";
import { isAllowedOrigin, csrfOk } from "./csrf";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-token";

// Route-level helpers shared by API handlers (WP-023/024a).

/** AUT-12 CSRF: the request Origin must match this app's own origin. */
export function originAllowed(request: Request): boolean {
  const self = new URL(request.url).origin;
  return isAllowedOrigin(request.headers.get("origin"), [self]);
}

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
 */
export function requireAdminResponse(scope: ScopeContext): NextResponse | null {
  return scope.role === "admin" ? null : jsonError("forbidden", "Admin access required.", 403);
}
