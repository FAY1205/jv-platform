import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { detectProfile } from "@/modules/sources";
import { SEED_SOURCE_PROFILES } from "@/modules/sources/seed-profiles";
import { loadRunRules } from "@/modules/run/rules";
import { processRun } from "@/modules/run/process";
import { DrizzleRunStore } from "@/modules/run/store";
import { withDbIdempotency, RequestInProgressError } from "@/lib/idempotency-db";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";

// POST /api/uploads — process a parsed weekly file end-to-end (WP-020). The client parses
// the workbook off the main thread (FEP-06) and posts { headers, rows }; the server detects
// the Source Profile, loads the tenant's rules, runs the pipeline, and persists the run.
const BodySchema = z.object({
  filename: z.string().min(1).max(255),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

export async function POST(req: Request) {
  if (!assertCsrf(req, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return jsonError("invalid_body", "Malformed upload payload.", 400);
  }

  // ING-02/08: exact signature auto-applies; anything else is surfaced, never silently guessed.
  const detected = detectProfile(body.headers, SEED_SOURCE_PROFILES);
  if (detected.status !== "exact" || !detected.profile) {
    return jsonError(
      "format_unrecognized",
      `File format not recognized (${detected.status}). The mapping/drift screen is coming; for now upload an InvestorFuse export.`,
      409,
    );
  }
  const profile = detected.profile;

  try {
    const scope = await getServerScope();
    const db = getDb();
    const { rules, snapshotParts } = await loadRunRules(scope);
    const key = body.idempotencyKey ?? newTraceId();
    const year = new Date().getUTCFullYear();

    const { response } = await withDbIdempotency(db, scope.tenantId, key, async () => {
      const store = new DrizzleRunStore(db);
      const result = await processRun(
        {
          tenantId: scope.tenantId,
          filename: body.filename,
          rows: body.rows,
          profile,
          rules,
          snapshotInput: { sourceProfile: { id: profile.id, version: profile.version }, ...snapshotParts },
          year,
          colorCoding: true,
        },
        { store, clock: () => new Date().toISOString() },
      );
      return { uploadRef: result.uploadRefId, summary: result.summary };
    });

    return jsonOk(response);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof RequestInProgressError) return jsonError("in_progress", "This upload is already being processed.", 409);
    return jsonError("process_failed", e instanceof Error ? e.message : "Processing failed.", 500);
  }
}
