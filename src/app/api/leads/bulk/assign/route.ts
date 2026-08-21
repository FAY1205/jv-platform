import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { logError } from "@/lib/observability";
import { bulkAssign } from "@/modules/leads/bulk";
import { InvalidAssignTargetError } from "@/modules/leads/commands";
import { notifyLeadAssigned, notifyLeadsBulkAssigned } from "@/modules/notify/outbox";
import { BulkBodyBase, bulkInputError } from "../shared";

// WP-N6 (N6-10..15) — bulk assign, from the leads list's selection bar. Full TRANSFER
// semantics (owner A1): any kept lead whose effective owner isn't already the destination
// moves, and only the additive manual overlay is written (PRN-05). The legacy
// /api/leads/assign-bulk endpoint is UNCHANGED and still serves the Unmatched page's
// unmatched-only flow — this is a different action with different eligibility, not a
// replacement.
const BodySchema = z.strictObject({ ...BulkBodyBase, partnerId: z.string().uuid() });

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bulkInputError(parsed.error);

  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.write");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;

    const { outcome, assignedPartnerId, partnerRefId, partnerName, appliedRef } = await bulkAssign(scope, {
      selection: parsed.data.selection,
      partnerId: parsed.data.partnerId,
      dryRun: parsed.data.dryRun,
    });
    // The destination the CONFIRM dialog names is this one — resolved by the server under the
    // tenant predicate, never the id the body proposed (PRN-08a).
    const partner = { id: assignedPartnerId, refId: partnerRefId, name: partnerName };
    if (outcome.dryRun) return jsonOk({ ...outcome, partner });

    // N6-15: after commit, best-effort, outside the transaction (the events.ts contract). One
    // destination per run makes the rollup one-summary-per-partner by construction (owner
    // decision 3); a single lead keeps the per-lead deep link the existing routes send.
    if (outcome.applied > 0) {
      try {
        if (appliedRef) await notifyLeadAssigned(getDb(), scope, { leadRef: appliedRef, partnerId: assignedPartnerId });
        else await notifyLeadsBulkAssigned(getDb(), scope, { partnerId: assignedPartnerId, count: outcome.applied });
      } catch (e) {
        logError("bulk_assign_notify_failed", { message: e instanceof Error ? e.message : String(e) });
      }
    }
    return jsonOk({ ...outcome, partner });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof InvalidAssignTargetError) return jsonError("invalid_target", e.message, 400);
    return jsonServerError("bulk_assign_failed", "Could not assign the leads.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
