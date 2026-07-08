import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { loadNotificationPrefs, saveNotificationPrefs, NotificationPrefsSchema, NOTIFICATION_EVENTS } from "@/modules/notify/prefs";
import { jsonOk, jsonError } from "@/lib/http";

// SET-03 / NTF-05: read + update the tenant's notification preferences. Admin-only.
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const prefs = await loadNotificationPrefs(getDb(), scope);
    return jsonOk({ prefs, events: NOTIFICATION_EVENTS });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("prefs_failed", "Could not load preferences.", 500);
  }
}

export async function PUT(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const parsed = NotificationPrefsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", "Invalid preferences.", 400);
    const prefs = await saveNotificationPrefs(getDb(), scope, parsed.data);
    return jsonOk({ code: "ok", message: "Preferences saved.", prefs });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("prefs_save_failed", "Could not save preferences.", 500);
  }
}
