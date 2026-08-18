import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import {
  deactivatePartner,
  PartnerNotFoundError,
  AlreadyDeactivatedError,
  ReassignmentRequiredError,
  InvalidReassignTargetError,
  HouseNotAllowedError,
} from "@/modules/partners/commands";
import { DeactivateSchema } from "@/modules/partners/schema";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";
import { NextResponse } from "next/server";
import { requireCapabilityResponse } from "@/lib/authz";

const IdSchema = z.string().uuid();

// ADM-03: deactivate a partner. If they still own territory, the body carries the
// reassignment decision (reassign → another partner, or route to Unmatched). When
// territory exists but no decision is given, respond 409 with the territory so the
// UI can prompt. PRN-05: historical assignments are never touched.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "partners.manage");
    if (gate) return gate;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);

    const raw = await request.json().catch(() => ({}));
    // The decision is optional — omitted when the partner owns no territory.
    let decision;
    if (raw && typeof raw === "object" && "mode" in raw) {
      const parsed = DeactivateSchema.safeParse(raw);
      if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
      decision = parsed.data;
    }

    const result = await deactivatePartner(scope, id, decision);
    return jsonOk({ code: "ok", message: "Partner deactivated.", result });
  } catch (e) {
    if (e instanceof ReassignmentRequiredError) {
      return NextResponse.json(
        { code: "reassignment_required", message: e.message, traceId: newTraceId(), territory: e.territory },
        { status: 409 },
      );
    }
    if (e instanceof InvalidReassignTargetError) return jsonError("invalid_target", e.message, 422);
    if (e instanceof HouseNotAllowedError) return jsonError("house_immutable", e.message, 422);
    if (e instanceof PartnerNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof AlreadyDeactivatedError) return jsonError("already_deactivated", e.message, 409);
    return authErrorResponse(e) ?? jsonError("partner_deactivate_failed", "Could not deactivate the partner.", 500);
  }
}
