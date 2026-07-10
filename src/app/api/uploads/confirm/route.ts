import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { findProfileById, saveProfileVersion } from "@/modules/sources/profile-store";
import { buildConfirmedProfile, missingRequiredFor, type Mapping } from "@/modules/sources/mapping";
import { runUpload } from "@/modules/run/run-upload";
import { RequestInProgressError } from "@/lib/idempotency-db";
import { MAX_UPLOAD_ROWS, exceedsBodyLimit, parseContentLength } from "@/lib/upload-guard";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";
import { NextResponse } from "next/server";

// F-86: bound the serverless function's runtime for a large-run process.
export const maxDuration = 60;

// POST /api/uploads/confirm — apply an admin-confirmed mapping (ING-02/08): save it
// as a new/next Source Profile version (DM-08), then process the run with it. A
// drift confirm keeps the base name/id lineage; an unknown file names a new format.
const BodySchema = z.object({
  filename: z.string().min(1).max(255),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_UPLOAD_ROWS),
  mapping: z.record(z.string(), z.string()),
  baseProfileId: z.string().optional(),
  newFormatName: z.string().trim().min(1).max(120).optional(),
  strictness: z.enum(["flexible", "strict"]).default("flexible"),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

export async function POST(req: Request) {
  if (!assertCsrf(req, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  if (exceedsBodyLimit(parseContentLength(req.headers.get("content-length")))) {
    return jsonError("payload_too_large", "That upload is too large to process.", 413);
  }
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return jsonError("invalid_body", "Malformed confirm payload.", 400);
  }

  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;

    const db = getDb();
    const mapping = body.mapping as Mapping;

    const base = body.baseProfileId ? await findProfileById(db, scope, body.baseProfileId) : null;
    if (body.baseProfileId && !base) return jsonError("not_found", "That format no longer exists.", 404);
    if (!base && !body.newFormatName) return jsonError("invalid_input", "Name this new format before saving.", 400);

    // ING-08: any required column must still be mapped to a present source column.
    const required = base?.requiredColumns ?? [];
    const missing = missingRequiredFor(mapping, required, body.headers);
    if (missing.length > 0) {
      return NextResponse.json(
        { code: "missing_required", message: `Still missing required column(s): ${missing.join(", ")}.`, traceId: newTraceId(), missingRequired: missing },
        { status: 422 },
      );
    }

    const profile = buildConfirmedProfile({
      base,
      name: base?.name ?? body.newFormatName!,
      uploadHeaders: body.headers,
      mapping,
      strictness: body.strictness,
    });
    const saved = await saveProfileVersion(db, scope, profile);

    const res = await runUpload(scope, {
      profile: saved,
      filename: body.filename,
      rows: body.rows,
      origin: new URL(req.url).origin,
      idempotencyKey: body.idempotencyKey,
    });
    return jsonOk({ result: "processed", savedProfile: { name: saved.name, version: saved.version }, ...res });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof RequestInProgressError) return jsonError("in_progress", "This upload is already being processed.", 409);
    return jsonError("confirm_failed", e instanceof Error ? e.message : "Could not process the mapping.", 500);
  }
}
