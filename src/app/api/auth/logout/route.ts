import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";

// AUT-14 (basic): server-side sign-out revokes the refresh token via Supabase and
// clears the session cookies (not just a client-side delete). Full "sign out all
// devices" + the app-owned session registry land in WP-024.

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  return NextResponse.json({ code: "ok", message: "Signed out." });
}
