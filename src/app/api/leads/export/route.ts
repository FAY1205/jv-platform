import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { jsonError, jsonServerError } from "@/lib/http";
import { renderSelectionExport } from "@/modules/export/render";
import { getSelectionExportData } from "@/modules/leads/export-selection";
import { describeFilters } from "@/modules/leads/filter-describe";
import { BulkSelectionSchema, canonicalBulkFilters, type BulkSelection } from "@/modules/leads/schema";
import { loadColorCoding } from "@/modules/settings/export-settings";
import { bulkInputError, emptySelectionError } from "../bulk/shared";

// ─────────────────────────────────────────────────────────────────────────────
// WP-N6 (N6-40..44) — export the leads list's current selection as the fixed EXP-02 workbook.
//
// POST, not GET, because the body carries the selection: a filter selection is nine fields
// that must be validated STRICTLY (N6-02), and putting them in a query string would drag the
// degrading read contract back into a surface that egresses seller PII. It is still a READ —
// no dry run, no skip report, nothing written or stored (N6-43).
//
// The gate is `data.export`, deliberately NOT `leads.write`: a seat may hold either without
// the other (N6-53), and this route's risk is EGRESS, which is what `data.export` names.
// ─────────────────────────────────────────────────────────────────────────────

const BodySchema = z.strictObject({ selection: BulkSelectionSchema });

/** N6-42 — the filter named in words, or the hand-built count. The renderer receives this as
 *  DATA so it stays pure (PRN-01); `describeFilters` is the SAME function the selection bar
 *  uses on screen, so the sheet and the bar cannot word the same selection differently. */
function describeSelection(selection: BulkSelection, names: { partners: Map<string, string>; tags: Map<string, string> }): string {
  if (selection.mode === "refs") {
    // The REQUESTED count, deduplicated as the resolvers deduplicate it. It can exceed the
    // exported total when a ref stopped resolving — that gap is the honest thing to show,
    // and the summary sheet puts both numbers side by side.
    const n = new Set(selection.leadRefs).size;
    return `${n.toLocaleString("en-US")} selected by hand`;
  }
  return describeFilters(canonicalBulkFilters(selection.filters), names) || "All leads";
}

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bulkInputError(parsed.error);

  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "data.export");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;

    const { selection } = parsed.data;
    const data = await getSelectionExportData(scope, selection);
    // Zero rows is not an empty workbook. The operator reached this dialog from a non-zero
    // count, so nothing resolving means the selection moved underneath them (a filter change,
    // a second tab, a recall) — the same failure the empty-refs boundary reports, and handing
    // them a header-only spreadsheet instead would hide it.
    if (data.exportLeads.length === 0) return emptySelectionError();

    const colorCoding = await loadColorCoding(scope); // SET-01: the workspace setting, never hardcoded
    const now = new Date();
    const bytes = await renderSelectionExport(
      data.exportLeads,
      data.partners,
      {
        selection: describeSelection(selection, {
          partners: new Map([...data.partners].map(([id, p]) => [id, `${p.name} (${p.refId})`])),
          tags: data.tagNames,
        }),
        exportedBy: data.exportedBy,
        // Route-side (PRN-01 keeps the renderer free of Date.now()). UTC and explicit about
        // it: the workbook outlives the session that made it and travels between timezones.
        exportedAt: `${now.toISOString().slice(0, 19).replace("T", " ")} UTC`,
      },
      { colorCoding },
    );

    // N6-43: synchronous, direct download. Nothing lands in Storage, and `no-store` keeps a
    // seller-PII deliverable out of every cache between here and the browser.
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="leads-selection-${now.toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    return jsonServerError("export_failed", "Could not export the selected leads.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
