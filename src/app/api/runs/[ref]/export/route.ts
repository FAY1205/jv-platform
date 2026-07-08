import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { getRunExportData } from "@/modules/run/export-data";
import { renderExport } from "@/modules/export/render";
import { jsonError } from "@/lib/http";

const RefSchema = z.string().regex(/^UP-\d{4}-\d{3,}$/);

// GET /api/runs/[ref]/export — regenerate the colored deliverable .xlsx from persisted leads.
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const parsed = RefSchema.safeParse(ref);
  if (!parsed.success) return jsonError("invalid_ref", "Invalid run reference.", 400);

  const scope = await getServerScope();
  const data = await getRunExportData(scope, parsed.data);
  if (!data) return jsonError("not_found", `Run ${parsed.data} not found.`, 404);

  const bytes = await renderExport(data.exportLeads, data.partners, data.summary, { colorCoding: true });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${data.refId}.xlsx"`,
    },
  });
}
