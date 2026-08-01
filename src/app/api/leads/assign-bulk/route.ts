import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { bulkAssignLeads, InvalidAssignTargetError } from "@/modules/leads/commands";
import { notifyLeadAssigned, notifyLeadsBulkAssigned } from "@/modules/notify/outbox";
import { logError } from "@/lib/observability";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";

const BodySchema = z.object({
  leadRefs: z.array(z.string().regex(/^LD-\d{2}-\d{5,}$/)).min(1).max(200),
  partnerId: z.string().uuid(),
});

// S6 (ASN-03): assign a selection of unmatched leads to one partner in one
// transaction. Admin-only; CSRF-guarded; scoped + audited per lead in the command.
// Leads that are no longer unmatched are skipped and reported, never overwritten
// (PRN-05 — the command only writes the additive manual overlay).
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

    const result = await bulkAssignLeads(scope, parsed.data);
    // Best-effort in-app notification: one per-lead link for a single assign, one
    // summary for a batch (never one bell entry per lead; ADR-0020 / ADR-0014).
    try {
      if (result.assigned.length === 1) {
        await notifyLeadAssigned(getDb(), scope, { leadRef: result.assigned[0], partnerId: parsed.data.partnerId });
      } else if (result.assigned.length > 1) {
        await notifyLeadsBulkAssigned(getDb(), scope, { partnerId: parsed.data.partnerId, count: result.assigned.length });
      }
    } catch (e) {
      logError("bulk_assign_notify_failed", { message: e instanceof Error ? e.message : String(e) });
    }

    const skippedNote = result.skipped.length > 0 ? ` ${result.skipped.length} could not be assigned (no longer unmatched).` : "";
    return jsonOk({
      code: "ok",
      message: `${result.assigned.length} lead${result.assigned.length === 1 ? "" : "s"} assigned to ${result.partnerRefId}.${skippedNote}`,
      assigned: result.assigned,
      skipped: result.skipped,
    });
  } catch (e) {
    if (e instanceof InvalidAssignTargetError) return jsonError("invalid_target", e.message, 400);
    return authErrorResponse(e) ?? jsonServerError("bulk_assign_failed", "Could not assign the leads.", { message: e instanceof Error ? e.message : String(e) });
  }
}
