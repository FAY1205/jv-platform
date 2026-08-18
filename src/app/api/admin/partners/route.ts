import { z } from "zod";
import { NextResponse } from "next/server";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import { listPartners } from "@/modules/partners/queries";
import { createPartnerWithCoverage } from "@/modules/partners/partner-with-coverage";
import { CoverageConflictError } from "@/modules/coverage/commands";
import { parseZipList, parseStateList } from "@/modules/coverage/parse";
import { PartnerCreateSchema } from "@/modules/partners/schema";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// ADM-03 partner roster. Admin-only; reads/writes go through the scope guard.
export async function GET() {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "partners.manage");
    if (gate) return gate;
    return jsonOk({ partners: await listPartners(scope) });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("partners_list_failed", "Could not load partners.", 500);
  }
}

// WP-C: coverage travels WITH the create so partner + first coverage are one atomic request.
const CoverageBody = z.object({ zips: z.string().max(200_000).default(""), states: z.string().max(20_000).default("") });

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "partners.manage");
    if (gate) return gate;

    const raw = await request.json().catch(() => null);
    const parsed = PartnerCreateSchema.safeParse(raw);
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);

    // Coverage is optional at create; if present, unrecognized tokens are rejected up front
    // (a typo must not silently drop coverage — same rule as the coverage PUT).
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

    const { partner } = await createPartnerWithCoverage(scope, parsed.data, { zips: zips.valid, states: states.valid });
    return jsonOk({ code: "ok", message: "Partner created.", partner });
  } catch (e) {
    // WP-C: an entered ZIP/state owned by another partner blocks the whole create (no orphan) —
    // the client shows which partner owns it so the owner can edit that partner first.
    if (e instanceof CoverageConflictError) {
      return NextResponse.json(
        { code: "coverage_conflict", message: e.message, traceId: newTraceId(), conflicts: e.conflicts },
        { status: 409 },
      );
    }
    return authErrorResponse(e) ?? jsonError("partner_create_failed", "Could not create the partner.", 500);
  }
}
