import { z } from "zod";
import { NextResponse } from "next/server";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { getPartner } from "@/modules/partners/queries";
import { updatePartner, PartnerNotFoundError } from "@/modules/partners/commands";
import { updatePartnerWithCoverage } from "@/modules/partners/partner-with-coverage";
import { CoverageConflictError } from "@/modules/coverage/commands";
import { parseZipList, parseStateList } from "@/modules/coverage/parse";
import { PartnerUpdateSchema } from "@/modules/partners/schema";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";

const IdSchema = z.string().uuid();
// WP-C: coverage may ride along with a contact edit so both are one atomic request.
const CoverageBody = z.object({ zips: z.string().max(200_000).default(""), states: z.string().max(20_000).default("") });

// ADM-03: a single partner (with current territory) + contact-detail edit.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);
    const partner = await getPartner(scope, id);
    if (!partner) return jsonError("not_found", "Partner not found.", 404);
    return jsonOk({ partner });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("partner_get_failed", "Could not load the partner.", 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);

    const raw = await request.json().catch(() => null);
    const parsed = PartnerUpdateSchema.safeParse(raw);
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    // Only touch coverage when the request actually carries it — a contact-only PATCH (no
    // zips/states keys) must never be read as "clear all coverage".
    const hasCoverage = !!raw && typeof raw === "object" && ("zips" in raw || "states" in raw);
    if (!hasCoverage) {
      await updatePartner(scope, id, parsed.data);
      return jsonOk({ code: "ok", message: "Partner updated." });
    }

    const cov = CoverageBody.safeParse(raw);
    const zips = parseZipList(cov.success ? cov.data.zips : "");
    const states = parseStateList(cov.success ? cov.data.states : "");
    if (zips.invalid.length > 0 || states.invalid.length > 0) {
      return NextResponse.json(
        {
          code: "invalid_coverage",
          message: "Some coverage entries weren't recognized. Fix them and try again.",
          traceId: newTraceId(),
          invalidZips: zips.invalid,
          invalidStates: states.invalid,
        },
        { status: 400 },
      );
    }

    await updatePartnerWithCoverage(scope, id, parsed.data, { zips: zips.valid, states: states.valid });
    return jsonOk({ code: "ok", message: "Partner updated." });
  } catch (e) {
    if (e instanceof PartnerNotFoundError) return jsonError("not_found", e.message, 404);
    // WP-C: a ZIP/state owned by another partner blocks the whole edit (contact change rolls back too).
    if (e instanceof CoverageConflictError) {
      return NextResponse.json(
        { code: "coverage_conflict", message: e.message, traceId: newTraceId(), conflicts: e.conflicts },
        { status: 409 },
      );
    }
    return authErrorResponse(e) ?? jsonError("partner_update_failed", "Could not update the partner.", 500);
  }
}
