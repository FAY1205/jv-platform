import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { jsonOk, jsonError } from "@/lib/http";

// AUT-04: an admin can clear a locked account's recent failed attempts. Admin-only,
// CSRF-protected. (A button surfaces with the admin activity screens — WP-034.)
const Input = z.object({
  email: z.email(),
  kind: z.enum(["login", "reset", "change_password"]).default("login"),
});

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }

  let role: "admin" | "partner";
  try {
    role = (await getServerScope()).role;
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("scope_failed", "Could not resolve session.", 500);
  }
  if (role !== "admin") {
    return jsonError("forbidden", "Admin only.", 403);
  }

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("invalid_input", "A valid email is required.", 400);
  }

  await new AuthAttemptsStore(getDb()).clearFailures(parsed.data.email, parsed.data.kind);
  return jsonOk({ code: "ok", message: "Account unlocked." });
}
