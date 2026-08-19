import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { NOTIFICATION_EVENTS, loadNotificationPrefs } from "@/modules/notify/prefs";
import {
  describeSubjectPrefs,
  loadSubjectOverride,
  saveSubjectOverride,
  PrefOverrideValueSchema,
} from "@/modules/notify/pref-overrides";
import { streamOf, type ScopeContext } from "@/lib/scope";

// GET/PUT /api/me/notification-prefs — NTF-15. A seat's OWN notification preferences, for
// BOTH streams.
//
// NO capability gate, deliberately: the tenant-DEFAULTS matrix at /api/settings/notifications is
// `settings.manage`-gated because it decides for everyone, but this route decides only for the
// caller. Gating it would leave member/viewer/partner seats with no way to turn off their own
// email — which is exactly the surface the tokenized unsubscribe exists to avoid needing.
//
// PRN-08 / PRN-08a: the subject is `{ tenantId, userId }` from the SCOPE, never from the body.
// There is no route shape here that could address another seat's row.
//
// ToS gate matches the sibling authenticated data routes (F-04/LGL-01, see /api/tasks).

/** The response both verbs return: the caller's resolved prefs for their own role bucket. */
async function currentView(scope: ScopeContext) {
  const db = getDb();
  const [prefs, overlay] = await Promise.all([
    loadNotificationPrefs(db, scope),
    loadSubjectOverride(db, scope.tenantId, { userId: scope.userId }),
  ]);
  // `streamOf` (lib/scope), not `streamPrefRole`: both answer "which bucket does this reader
  // use", but streamOf takes the SCOPE and is the app-wide definition of the PRN-13 stream, so a
  // route that already holds a scope should never re-derive it from the bare role string.
  // streamPrefRole stays for the DB-ROW call site in task-reminders, which has a `users` row and
  // no scope to hand.
  return describeSubjectPrefs(prefs, overlay, streamOf(scope));
}

/** NTF-15: the event keys the CALLER'S bucket actually owns. */
function keysForCaller(scope: ScopeContext): Set<string> {
  const role = streamOf(scope);
  return new Set(NOTIFICATION_EVENTS.filter((e) => e.role === role).map((e) => e.key));
}

export async function GET() {
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    return jsonOk(await currentView(scope));
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonServerError("my_notification_prefs_failed", "Could not load your notification preferences.", {
        message: e instanceof Error ? e.message : String(e),
      })
    );
  }
}

export async function PUT(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    const parsed = PrefOverrideValueSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", "Invalid notification preferences.", 400);
    // The schema validates keys against the WHOLE catalog; this narrows them to the caller's own
    // ROLE BUCKET. A partner storing `run_summary` would be writing a key their bucket can never
    // resolve — invisible in their own GET, silently dead, and a slow way to accumulate rows that
    // mean nothing. Refuse it rather than persist a preference that can never take effect.
    const allowed = keysForCaller(scope);
    const foreign = Object.keys(parsed.data.events ?? {}).filter((k) => !allowed.has(k));
    if (foreign.length > 0) {
      return jsonError("invalid_input", "Those notification types do not apply to your account.", 400);
    }
    await saveSubjectOverride(getDb(), scope.tenantId, { userId: scope.userId }, parsed.data);
    // Re-read rather than echo the request: the response is the same resolved shape GET returns,
    // so the client renders one representation and never a locally-merged guess (PRN-15).
    return jsonOk(await currentView(scope));
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonServerError("my_notification_prefs_save_failed", "Could not save your notification preferences.", {
        message: e instanceof Error ? e.message : String(e),
      })
    );
  }
}
