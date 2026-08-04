import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { getPartnerExportData } from "@/modules/portal/queries";
import { renderExport } from "@/modules/export/render";
import { loadColorCoding } from "@/modules/settings/export-settings";
import { jsonServerError } from "@/lib/http";

// GET /api/portal/leads/export — the caller's own leads as a colored .xlsx (PTL-04).
// Reuses the export renderer (SEC-06 cell sanitization). Scoped (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data on ToS acceptance
    if (tos) return tos;
    const data = await getPartnerExportData(scope);
    const colorCoding = await loadColorCoding(scope); // F-39: honor the tenant setting (SET-01)
    const bytes = await renderExport(data.exportLeads, data.partners, data.summary, { colorCoding });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="my-leads.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("export_failed", "Export failed.", { message: e instanceof Error ? e.message : String(e) });
  }
}
