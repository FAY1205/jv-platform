import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { bulkStatus } from "@/modules/leads/bulk";
import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";
import { BulkBodyBase, bulkInputError } from "../shared";

// WP-N6 (N6-20..23) — set the workflow status across a selection. N6-20: the status is
// validated at the boundary against the SEAM-06 vocabulary (the admin single-lead route's
// precedent), never accepted as a bare string. N6-23: this emits NO notifications, matching
// that same route — the portal's own status path is untouched.
const BodySchema = z.strictObject({ ...BulkBodyBase, status: z.enum(SEED_LEAD_STATUSES) });

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

    const outcome = await bulkStatus(scope, {
      selection: parsed.data.selection,
      status: parsed.data.status,
      dryRun: parsed.data.dryRun,
    });
    return jsonOk({ ...outcome, status: parsed.data.status });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    return jsonServerError("bulk_status_failed", "Could not update the statuses.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
