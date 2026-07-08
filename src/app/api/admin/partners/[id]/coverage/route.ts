import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { setPartnerCoverage } from "@/modules/coverage/commands";
import { parseZipList, parseStateList } from "@/modules/coverage/parse";
import { PartnerNotFoundError } from "@/modules/partners/commands";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";
import { NextResponse } from "next/server";

const IdSchema = z.string().uuid();
const Body = z.object({ zips: z.string().max(200_000).default(""), states: z.string().max(20_000).default("") });

// CVG-01: set a partner's coverage from the ZIP/state lists typed on the partner
// screen. Reject any unrecognized token (a typo must not silently drop coverage,
// since the entry is the partner's COMPLETE set); apply the validated set versioned.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const { id } = await params;
    if (!IdSchema.safeParse(id).success) return jsonError("invalid_id", "Invalid partner id.", 400);

    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", "Invalid coverage payload.", 400);

    const zips = parseZipList(parsed.data.zips);
    const states = parseStateList(parsed.data.states);
    if (zips.invalid.length > 0 || states.invalid.length > 0) {
      return NextResponse.json(
        {
          code: "invalid_coverage",
          message: "Some entries weren't recognized. Fix them and save again.",
          traceId: newTraceId(),
          invalidZips: zips.invalid,
          invalidStates: states.invalid,
        },
        { status: 400 },
      );
    }

    const change = await setPartnerCoverage(scope, id, { zips: zips.valid, states: states.valid });
    return jsonOk({ code: "ok", message: "Coverage updated.", change });
  } catch (e) {
    if (e instanceof PartnerNotFoundError) return jsonError("not_found", e.message, 404);
    return authErrorResponse(e) ?? jsonError("coverage_failed", "Could not update coverage.", 500);
  }
}
