import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";

// AUT-14: server-side sign-out. Scope maps to Supabase's revocation:
//   local  → this device only (default)
//   others → every other device, keep this one
//   global → all devices ("sign out everywhere")
// This revokes refresh tokens server-side, not just a cookie delete.
const Input = z.object({ scope: z.enum(["local", "others", "global"]).default("local") });

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const parsed = Input.safeParse(await request.json().catch(() => ({})));
  const scope = parsed.success ? parsed.data.scope : "local";

  const supabase = await getSupabaseServer();
  await supabase.auth.signOut({ scope });
  return NextResponse.json({ code: "ok", message: "Signed out." });
}
