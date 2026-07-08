import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env, isProduction } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import { newCsrfToken, CSRF_COOKIE_NAME } from "@/lib/auth/csrf-token";

// ─────────────────────────────────────────────────────────────────────────────
// Auth proxy (WP-023; Next 16 renamed the `middleware` convention to `proxy`).
// Central place to (1) refresh the Supabase session and write rotated cookies
// back — the @supabase/ssr requirement, (2) redirect unauthenticated users away
// from protected PAGES, and (3) stamp no-store on authed responses (AUT-13). API
// routes self-guard via getServerScope (uniform 401/403 envelope), so this proxy
// does not JSON-block them.
// ─────────────────────────────────────────────────────────────────────────────

// Protected page prefixes. Public: "/", "/login", "/forgot", "/reset", "/gallery",
// "/portal/login", static assets.
const PROTECTED_PAGE_PREFIXES = ["/runs", "/upload", "/account", "/portal"];
const PUBLIC_EXCEPTIONS = ["/portal/login"];

function isProtectedPage(pathname: string): boolean {
  if (PUBLIC_EXCEPTIONS.includes(pathname)) return false;
  return PROTECTED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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

  // getUser() validates the JWT and refreshes if needed (writing cookies via setAll).
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
