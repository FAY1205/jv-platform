import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import { isCallerPlatformOwner, callerEmail } from "@/lib/auth/platform-owner";
import { issueSignupCode } from "@/lib/auth/signup-code";
import { SignupCodeStore } from "@/lib/auth/signup-code-store";
import { jsonOk, jsonError } from "@/lib/http";

// SCP-03: owner-only signup invitation codes. Gated to a tenant admin whose email is
// on the platform ADMIN_ALLOWLIST (no platform role exists — see platform-owner.ts).
// GET lists active (unused, unexpired) codes; POST mints one (plaintext shown once);
// DELETE revokes an unused one. The plaintext is never stored or re-shown.

const notOwner = () => jsonError("forbidden", "Not available.", 403);

export async function GET() {
  try {
    const scope = await getServerScope();
    if (!(await isCallerPlatformOwner(scope))) return notOwner();
    const codes = await new SignupCodeStore(getDb()).listActive(Date.now());
    return jsonOk({ codes });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("codes_failed", "Could not load invitation codes.", 500);
  }
}

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    if (!(await isCallerPlatformOwner(scope))) return notOwner();
    const email = (await callerEmail(scope)) ?? "unknown";
    const store = new SignupCodeStore(getDb());
    // Mint + persist; on the astronomically-rare hash collision (unique index), retry.
    let code = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const issued = issueSignupCode(Date.now());
      try {
        await store.persist(issued.record, email);
        code = issued.code;
        break;
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }
    // The plaintext is returned ONCE here and never stored — the owner copies it now.
    return jsonOk({ code, message: "Copy this code now — it won't be shown again." });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("code_generate_failed", "Could not generate a code.", 500);
  }
}

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    if (!(await isCallerPlatformOwner(scope))) return notOwner();
    const parsed = DeleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", "A code id is required.", 400);
    await new SignupCodeStore(getDb()).revoke(parsed.data.id);
    return jsonOk({ code: "ok", message: "Code revoked." });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("code_revoke_failed", "Could not revoke the code.", 500);
  }
}
