import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { unmatchedCoverageMatches } from "@/modules/leads/queries";
import { bulkAssignByCoverage, InvalidAssignTargetError } from "@/modules/leads/commands";
import { notifyLeadAssigned, notifyLeadsBulkAssigned } from "@/modules/notify/outbox";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";

// S6 coverage backfill (owner note #2): after adding a partner (or coverage), the
// unmatched page offers "assign the leads their coverage now matches" in one click.
// GET lists per-partner match counts; POST assigns one partner's matches. Admin-only;
// derivation uses the pipeline's generic zip-beats-state precedence (ASN-02) and
// assignment stays PRN-05-clean (additive overlay via the bulk command).

export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const matches = await unmatchedCoverageMatches(scope);
    return jsonOk({ matches });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("backfill_failed", "Could not check coverage matches.", 500);
  }
}

const BodySchema = z.object({ partnerId: z.string().uuid() });

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    const result = await bulkAssignByCoverage(scope, parsed.data.partnerId);
    try {
      if (result.assigned.length === 1) {
        await notifyLeadAssigned(getDb(), scope, { leadRef: result.assigned[0], partnerId: parsed.data.partnerId });
      } else if (result.assigned.length > 1) {
        await notifyLeadsBulkAssigned(getDb(), scope, { partnerId: parsed.data.partnerId, count: result.assigned.length });
      }
    } catch (e) {
      logError("backfill_notify_failed", { message: e instanceof Error ? e.message : String(e) });
    }

    return jsonOk({
      code: "ok",
      message: `${result.assigned.length} lead${result.assigned.length === 1 ? "" : "s"} assigned to ${result.partnerRefId}.`,
      assigned: result.assigned,
    });
  } catch (e) {
    if (e instanceof InvalidAssignTargetError) return jsonError("invalid_target", e.message, 400);
    return authErrorResponse(e) ?? jsonServerError("backfill_assign_failed", "Could not assign the leads.", { message: e instanceof Error ? e.message : String(e) });
  }
}
