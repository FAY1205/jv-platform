import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { getPartnerExportData } from "@/modules/portal/queries";
import { renderExport } from "@/modules/export/render";
import { jsonError } from "@/lib/http";

// GET /api/portal/leads/export — the caller's own leads as a colored .xlsx (PTL-04).
// Reuses the export renderer (SEC-06 cell sanitization). Scoped (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const data = await getPartnerExportData(scope);
    const bytes = await renderExport(data.exportLeads, data.partners, data.summary, { colorCoding: true });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="my-leads.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("export_failed", e instanceof Error ? e.message : "Export failed.", 500);
  }
}
