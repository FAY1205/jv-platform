import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere } from "@/lib/scope";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { getRunExportData } from "@/modules/run/export-data";
import { renderExport } from "@/modules/export/render";
import { loadColorCoding } from "@/modules/settings/export-settings";
import { signedExportUrl } from "@/modules/export/storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logError } from "@/lib/observability";
import { jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

const RefSchema = z.string().regex(/^IM-\d{2}-\d{3,}$/);

// GET /api/runs/[ref]/export — download the colored deliverable .xlsx (EXP-05).
// Prefer a short-lived signed URL to the stored file (SEC-02); fall back to
// regenerating from persisted leads for runs stored before EXP-05 (or if storage
// is unavailable). The rules snapshot pins determinism, so regeneration is faithful.
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const parsed = RefSchema.safeParse(ref);
  if (!parsed.success) return jsonError("invalid_ref", "Invalid run reference.", 400);

  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "data.export");
    if (gate) return gate;

    const [upload] = await getDb()
      .select({ status: schema.uploads.status, storagePath: schema.uploads.storagePath })
      .from(schema.uploads)
      .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, parsed.data)));

    // WP-J2 (ING-09): a voided run's leads are recalled — its deliverable (the stored blob predates
    // the void and would still carry recalled leads' PII) is no longer downloadable.
    if (upload?.status === "voided") {
      return jsonError("run_voided", `Run ${parsed.data} was voided — its export is no longer available.`, 409);
    }

    // If we have a stored file, hand back a signed URL (private bucket, no regen).
    if (upload?.storagePath) {
      try {
        const url = await signedExportUrl(getSupabaseAdmin(), upload.storagePath, `${parsed.data}.xlsx`);
        return Response.redirect(url, 302);
      } catch (e) {
        // Signing failed — fall through to regenerate rather than 500 the download.
        logError("export_sign_failed", { message: e instanceof Error ? e.message : String(e) });
      }
    }

    const data = await getRunExportData(scope, parsed.data);
    if (!data) return jsonError("not_found", `Run ${parsed.data} not found.`, 404);

    const colorCoding = await loadColorCoding(scope); // F-39: honor the tenant setting (SET-01)
    const bytes = await renderExport(data.exportLeads, data.partners, data.summary, { colorCoding });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${data.refId}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("export_failed", e instanceof Error ? e.message : "Export failed.", 500)
    );
  }
}
