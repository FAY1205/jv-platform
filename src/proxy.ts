import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { env, isProduction } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import { newCsrfToken, CSRF_COOKIE_NAME } from "@/lib/auth/csrf-token";
import { logError } from "@/lib/observability";

// ─────────────────────────────────────────────────────────────────────────────
// Auth proxy (WP-023; Next 16 renamed the `middleware` convention to `proxy`).
// Central place to (1) refresh the Supabase session and write rotated cookies
// back — the @supabase/ssr requirement, (2) redirect unauthenticated users away
// from protected PAGES, and (3) stamp no-store on authed responses (AUT-13). API
// routes self-guard via getServerScope (uniform 401/403 envelope), so this proxy
// does not JSON-block them.
// ─────────────────────────────────────────────────────────────────────────────

// Protected page prefixes. Public: "/", "/login", "/forgot", "/reset", "/gallery",
// "/terms", "/portal/login", static assets.
// C-55: "/terms" (the public read-only Terms of Service & Privacy Policy) is DELIBERATELY
// public and must stay absent from the list below — it is what /signup's consent checkbox
// links to, so a prospect can read the terms before they have an account. Do not "fix" it
// by adding it here; the gated ACCEPTANCE screens live at "/tos", which stays protected.
// "/runs" stays listed defensively: next.config redirects it to /imports (old
// notification deep links, bookmarks), and the prefix guard is belt-and-braces.
// WP-TSK-5: "/tasks" (admin My Tasks) is a new page and needs its own entry — API routes
// self-guard (getServerScope) but pages don't. "/portal/tasks" needs no separate entry: it
// already falls under the "/portal" prefix below (prefix match, not exact), same as every
// other /portal/* page.
const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/tos", "/imports", "/runs", "/upload", "/account", "/portal", "/leads", "/unmatched", "/dev", "/partners", "/coverage", "/settings", "/rules", "/activity", "/tasks"];
const PUBLIC_EXCEPTIONS = ["/portal/login"];

function isProtectedPage(pathname: string): boolean {
  if (PUBLIC_EXCEPTIONS.includes(pathname)) return false;
  return PROTECTED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// A returning visitor whose refresh token has expired or rotated makes supabase.auth.getUser()
// THROW AuthApiError(refresh_token_not_found, status 400) — a benign "your session ended", not an
// application fault, so the request is simply unauthenticated (the redirect below handles it).
//
// Match ONLY the specific auth-error codes/name that mean the LOCAL session is dead — an
// expired/reused/missing refresh token. NOT every 4xx: GoTrue also returns 4xx AuthApiErrors for
// rate-limiting (over_request_rate_limit, 429), a banned user (user_banned, 403), and a bad or
// revoked SUPABASE_ANON_KEY (an uncoded 401). Those are operationally significant — silently
// bouncing every affected visitor to /login with no Sentry signal is exactly the invisible-outage
// failure ADR-0032 exists to prevent — so they fall through to the caller's re-throw → Sentry.
const ENDED_SESSION_CODES = new Set(["refresh_token_not_found", "refresh_token_already_used", "session_not_found"]);

export function isEndedSessionError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { __isAuthError?: unknown; status?: unknown; code?: unknown; name?: unknown };
  if (err.__isAuthError !== true || typeof err.status !== "number" || err.status < 400 || err.status >= 500) {
    return false;
  }
  // AuthSessionMissingError ("no session") is identified by name — it carries no `code`.
  if (err.name === "AuthSessionMissingError") return true;
  return typeof err.code === "string" && ENDED_SESSION_CODES.has(err.code);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Before Supabase keys are configured, auth can't run. In production that is a
  // misconfiguration; in dev/preview we pass through so the app is usable before
  // the owner wires the dev Auth project (protected pages are simply open then).
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    if (isProduction) {
      throw new Error("Supabase Auth is not configured in production — refusing to serve unauthenticated.");
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the JWT and refreshes if needed (writing cookies via setAll). It THROWS on
  // an expired/rotated refresh token — and also on a genuine Supabase Auth outage (5xx), a rate
  // limit, or a misconfig. Handle the three cases distinctly so a benign session-end stays quiet,
  // a real failure stays visible, and an outage never takes down a page that needs no session.
  let user: User | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (e) {
    if (isEndedSessionError(e)) {
      // Benign: the local session ended. Unauthenticated — the redirect below handles protected
      // pages; public pages render logged-out. Deliberately NOT a Sentry event (ADR-0032).
    } else if (isProtectedPage(pathname)) {
      // A genuinely unexpected auth failure on a page that REQUIRES a session: fail closed and let
      // it reach Sentry (onRequestError). We cannot verify the user, so we must not serve protected
      // content against an unverifiable session.
      throw e;
    } else {
      // The same failure on a PUBLIC page (/, /login, /gallery, /portal/login, …): the page needs
      // no session, so a Supabase Auth outage must NOT 500 it — least of all the login page a
      // visitor needs to recover. Surface the outage (so it stays visible even with no protected
      // traffic in the window), then fall through and render logged-out.
      logError("proxy_auth_unavailable", { path: pathname, message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (isProtectedPage(pathname) && !user) {
    // Partners onboard via the portal OTP screen; admins via the password screen.
    const loginPath = pathname.startsWith("/portal") ? "/portal/login" : "/login";
    const loginUrl = new URL(loginPath, request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user) {
    // AUT-13: never cache authenticated responses (back button reveals no data).
    response.headers.set("Cache-Control", "no-store");
    // AUT-12: issue the readable double-submit CSRF token if the session lacks one.
    // Readable (not HttpOnly) so the client echoes it in the x-csrf-token header.
    if (!request.cookies.get(CSRF_COOKIE_NAME)) {
      response.cookies.set(CSRF_COOKIE_NAME, newCsrfToken(), {
        httpOnly: false,
        secure: true,
        sameSite: "lax",
        path: "/",
      });
    }
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
