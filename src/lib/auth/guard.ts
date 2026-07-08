import { type NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { UnauthenticatedError, NotProvisionedError } from "@/lib/scope-context";
import { isAllowedOrigin } from "./csrf";

// Route-level helpers shared by API handlers (WP-023).

/** AUT-12 CSRF: the request Origin must match this app's own origin. */
export function originAllowed(request: Request): boolean {
  const self = new URL(request.url).origin;
  return isAllowedOrigin(request.headers.get("origin"), [self]);
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
