import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import { recentDevEmails, clearDevMailbox } from "@/modules/notify/dev-mailbox";
import { isProduction } from "@/lib/env";
import { jsonOk, jsonError } from "@/lib/http";

// Dev-only "sent emails" viewer API. SEC-07: this surface must never exist in
// production — a hard 404 before anything else. Admin-only. It reveals only what
// the non-prod email sink captured (OTP codes / invite + reset links) so the
// owner can self-test onboarding without a real inbox.

function guardProd() {
  return isProduction ? jsonError("not_found", "Not found.", 404) : null;
}

async function requireAdmin() {
  const scope = await getServerScope();
  if (scope.role !== "admin") throw Object.assign(new Error("forbidden"), { forbidden: true });
  return scope;
}

export async function GET() {
  const blocked = guardProd();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    return jsonOk({ emails: recentDevEmails() });
  } catch (e) {
    if ((e as { forbidden?: boolean }).forbidden) return jsonError("forbidden", "Admin only.", 403);
    return authErrorResponse(e) ?? jsonError("dev_emails_failed", "Could not load emails.", 500);
  }
}

/** Clear the captured mailbox (dev convenience). */
export async function DELETE(request: Request) {
  const blocked = guardProd();
  if (blocked) return blocked;
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    await requireAdmin();
    clearDevMailbox();
    return jsonOk({ code: "ok", message: "Cleared." });
  } catch (e) {
    if ((e as { forbidden?: boolean }).forbidden) return jsonError("forbidden", "Admin only.", 403);
    return authErrorResponse(e) ?? jsonError("dev_emails_failed", "Could not clear emails.", 500);
  }
}
