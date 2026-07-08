import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env, isProduction } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

// ─────────────────────────────────────────────────────────────────────────────
// Auth proxy (WP-023; Next 16 renamed the `middleware` convention to `proxy`).
// Central place to (1) refresh the Supabase session and write rotated cookies
// back — the @supabase/ssr requirement, (2) redirect unauthenticated users away
// from protected PAGES, and (3) stamp no-store on authed responses (AUT-13). API
// routes self-guard via getServerScope (uniform 401/403 envelope), so this proxy
// does not JSON-block them.
// ─────────────────────────────────────────────────────────────────────────────

// Protected page prefixes. Public: "/", "/login", "/gallery", static assets.
const PROTECTED_PAGE_PREFIXES = ["/runs", "/upload", "/account"];

function isProtectedPage(pathname: string): boolean {
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
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // AUT-13: never cache authenticated responses (back button reveals no data).
  if (user) response.headers.set("Cache-Control", "no-store");

  return response;
}

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
