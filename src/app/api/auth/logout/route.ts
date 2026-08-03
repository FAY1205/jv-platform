import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { getSupabaseServer } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { TRUST_COOKIE_NAME, TRUST_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

// AUT-14: server-side sign-out. Scope maps to Supabase's revocation:
//   local  → this device only (default)
//   others → every other device, keep this one
//   global → all devices ("sign out everywhere")
// This revokes refresh tokens server-side, not just a cookie delete. It ALSO revokes the
// trusted-device ("remember this device", AUT-10) credential — a separate long-lived
// token that Supabase's signOut does not touch. Without this, a remembered partner is
// bounced straight back in: the portal login page auto-refreshes from the surviving trust
// token on mount, so "sign out" appeared to do nothing.
const Input = z.object({ scope: z.enum(["local", "others", "global"]).default("local") });

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const parsed = Input.safeParse(await request.json().catch(() => ({})));
  const scope = parsed.success ? parsed.data.scope : "local";

  const supabase = await getSupabaseServer();
  // The verified auth uid (== users.id == trusted_devices.userId) authorizes revoking this
  // caller's OWN remembered devices for the global/others scopes.
  const { data: { user } } = await supabase.auth.getUser();

  const store = await cookies();
  const trustToken = store.get(TRUST_COOKIE_NAME)?.value;
  const svc = new TrustedDeviceService(getDb());
  const now = Date.now();

  if (scope === "global" && user) {
    await svc.revokeAllForUser(user.id, now);
  } else if (trustToken) {
    const familyId = await svc.familyForToken(trustToken);
    if (familyId) {
      if (scope === "others" && user) await svc.revokeOtherFamilies(user.id, familyId, now);
      else await svc.revokeFamily(familyId, now); // local
    }
  }
  // Drop this browser's trust cookie so the login auto-refresh finds nothing — except for
  // "others", which deliberately keeps THIS device signed in and remembered.
  if (scope !== "others") {
    store.set(TRUST_COOKIE_NAME, "", { ...TRUST_COOKIE_OPTIONS, maxAge: 0 });
  }

  await supabase.auth.signOut({ scope });
  return NextResponse.json({ code: "ok", message: "Signed out." });
}
