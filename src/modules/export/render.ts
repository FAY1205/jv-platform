import ExcelJS from "exceljs";
import type { RunSummary } from "../analytics/run-summary";
import { contrastRatio } from "@/lib/contrast";

// ─────────────────────────────────────────────────────────────────────────────
// Export renderer (EXP-02..06, SEC-06, PRN-14). Deterministic transform:
// (leads, partners, summary, options) → xlsx bytes. No DB/fetch/Date.now (PRN-01).
// Determinism is verified SEMANTICALLY (reload + compare), never by byte-diff —
// the xlsx container embeds nondeterministic metadata. This is the TST-05 contract.
//
// SEC-06: every user-originated cell is sanitised against formula injection.
// PRN-14: partner name + PR-### ref accompany the color in every row and the
// legend — color is never the sole signal; fills keep AA-contrast text.
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed export column order (EXP-02) — the SEAM-03 seed; tenants may reorder later. */
export const EXPORT_COLUMNS = [
  "Lead ID",
  "Campaign",
  "Date Created",
  "JV Notes",
  "Notes",
  "Address",
  "City",
  "State",
  "Zip",
  "Seller First Name",
  "Seller Last Name",
  "Seller Phone",
  "Seller Email Address",
  "Reason For Selling",
  "Motivation",
  "Time to Sell",
  "JV Partner Name",
  "Possible MLS Listing",
] as const;

export interface ExportLead {
  leadRefId: string;
  campaign: string;
  dateCreated: string;
  notes: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  sellerFirst: string;
  sellerLast: string;
  phone: string;
  email: string;
  reasonForSelling: string;
  motivation: string;
  timeToSell: string;
  partnerId: string | null;
  possibleMlsListing: "yes" | "no" | "unknown" | "pending";
}

// A persisted lead row as either export path reads it. Fields are widened to accept both
// the admin and portal Drizzle selects (nullable text columns coalesce to "").
export interface ExportLeadSource {
  refId: string;
  campaign?: string | null;
  dateCreated?: string | null;
  notes?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  sellerFirst?: string | null;
  sellerLast?: string | null;
  phone?: string | null;
  email?: string | null;
  reasonForSelling?: string | null;
  motivation?: string | null;
  timeToSell?: string | null;
  partnerId: string | null;
  possibleMlsListing: "yes" | "no" | "unknown" | "pending";
}

// R-11 / EXP-SS: the ONE serializer for the fixed export row shape. Both export paths (admin
// run download, partner portal export) build ExportLead through here, so a field added to the
// contract can't land in one and be forgotten in the other. `blankCampaign` is the explicit,
// tested option for the partner-facing path — lead source stays admin-only (PRN-08) and must
// never appear in a partner's deliverable.
export function toExportLead(l: ExportLeadSource, opts?: { blankCampaign?: boolean }): ExportLead {
  return {
    leadRefId: l.refId,
    campaign: opts?.blankCampaign ? "" : l.campaign ?? "",
    dateCreated: l.dateCreated ?? "",
    notes: l.notes ?? "",
    address: l.address ?? "",
    city: l.city ?? "",
    state: l.state ?? "",
    zip: l.zip ?? "",
    sellerFirst: l.sellerFirst ?? "",
    sellerLast: l.sellerLast ?? "",
    phone: l.phone ?? "",
    email: l.email ?? "",
    reasonForSelling: l.reasonForSelling ?? "",
    motivation: l.motivation ?? "",
    timeToSell: l.timeToSell ?? "",
    partnerId: l.partnerId,
    possibleMlsListing: l.possibleMlsListing,
  };
}

export interface PartnerInfo {
  id: string;
  name: string;
  refId: string;
  /** Locked color as #RRGGBB (PRN-06). */
  color: string;
}

export interface RenderOptions {
  /** SET-01: ON = full-row fills; OFF = bold group-header rows. */
  colorCoding: boolean;
}

const UNMATCHED = "__unmatched__";

/**
 * SEC-06: neutralise a cell that Excel would treat as a formula.
 *
 * Exported (N6-42): the `Selection_Summary` sheet carries user-originated text the LEAD rows
 * never see — the operator's search term, tag names inside the filter sentence, a seat's email
 * — and it is assembled in the route, not here. A second private copy of this rule in the
 * caller is how one of the two ends up with a narrower character class.
 */
export function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function hexToArgb(hex: string): string {
  return "FF" + hex.replace(/^#/, "").toUpperCase();
}

/**
 * Pick black or white text for the strongest WCAG contrast against a fill
 * (PRN-14, SC 1.4.3). Supersedes the old YIQ-brightness heuristic, which chose the
 * FAILING color on ~40% of the Survey partner tints (e.g. clay #B4623F → white 4.41:1
 * when black is 4.76; seafoam #5E9E8E → white 3.11 when black is 6.76). Pure black/white —
 * not #111 — is required to hold AA margin on the borderline tints (clay, slate). Returns
 * an exceljs ARGB. WP-H: the luminance math is the shared `contrastRatio` primitive.
 */
export function contrastText(hex: string): "FF000000" | "FFFFFFFF" {
  return contrastRatio("#000000", hex) >= contrastRatio("#FFFFFF", hex) ? "FF000000" : "FFFFFFFF";
}

function partnerLabel(partnerId: string | null, partners: ReadonlyMap<string, PartnerInfo>): string {
  if (partnerId === null) return "Unmatched";
  const p = partners.get(partnerId);
  return p ? `${p.name} (${p.refId})` : partnerId;
}

function leadRowValues(lead: ExportLead, partners: ReadonlyMap<string, PartnerInfo>): string[] {
  return [
    lead.leadRefId,
    lead.campaign,
    lead.dateCreated,
    "", // JV Notes — intentionally blank for the partner to fill (EXP-02)
    lead.notes,
    lead.address,
    lead.city,
    lead.state,
    lead.zip,
    lead.sellerFirst,
    lead.sellerLast,
    lead.phone,
    lead.email,
    lead.reasonForSelling,
    lead.motivation,
    lead.timeToSell,
    partnerLabel(lead.partnerId, partners),
    lead.possibleMlsListing,
  ].map((v) => sanitizeCell(String(v ?? "")));
}

/** Order groups deterministically: partners by refId, then Unmatched last. */
function orderedGroupKeys(
  groups: Map<string, ExportLead[]>,
  partners: ReadonlyMap<string, PartnerInfo>,
): string[] {
  const partnerKeys = [...groups.keys()]
    .filter((k) => k !== UNMATCHED)
    .sort((a, b) => {
      const ra = partners.get(a)?.refId ?? a;
      const rb = partners.get(b)?.refId ?? b;
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    });
  return groups.has(UNMATCHED) ? [...partnerKeys, UNMATCHED] : partnerKeys;
}

/**
 * The two sheets EVERY export shares: the fixed 18-column `Leads` sheet grouped by partner,
 * and `JV_Color_Legend`. Returns the grouping so the caller's own summary sheet counts the
 * SAME buckets the workbook rendered — a per-partner tally derived a second way is a tally
 * that can disagree with the sheet it summarises.
 *
 * N6-41: the selection export and the run/portal exports go through here together, so the
 * EXP-02 contract cannot drift between them (R-11, one serializer chain).
 */
function addLeadSheets(
  wb: ExcelJS.Workbook,
  leads: readonly ExportLead[],
  partners: ReadonlyMap<string, PartnerInfo>,
  options: RenderOptions,
): Map<string, ExportLead[]> {
  // ── Leads sheet (grouped by partner) ──
  const ws = wb.addWorksheet("Leads");
  const header = ws.addRow([...EXPORT_COLUMNS]);
  header.eachCell((cell) => (cell.font = { bold: true }));

  const groups = new Map<string, ExportLead[]>();
  for (const lead of leads) {
    const key = lead.partnerId ?? UNMATCHED;
    const bucket = groups.get(key);
    if (bucket) bucket.push(lead);
    else groups.set(key, [lead]);
  }

  for (const key of orderedGroupKeys(groups, partners)) {
    const label = key === UNMATCHED ? "Unmatched" : partnerLabel(key, partners);

    // Color OFF: a bold group-header row separates partners (EXP-06).
    if (!options.colorCoding) {
      const hdr = ws.addRow([sanitizeCell(label)]); // SEC-06: partner name is user-originated (F-26)
      hdr.getCell(1).font = { bold: true };
    }

    for (const lead of groups.get(key)!) {
      const row = ws.addRow(leadRowValues(lead, partners));

      // Color ON: full-row fill in the locked partner color + AA-contrast text (EXP-06).
      if (options.colorCoding && key !== UNMATCHED) {
        const partner = partners.get(key);
        if (partner) {
          const argb = hexToArgb(partner.color);
          const fontColor = contrastText(partner.color);
          for (let c = 1; c <= EXPORT_COLUMNS.length; c++) {
            const cell = row.getCell(c);
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
            cell.font = { color: { argb: fontColor } };
          }
        }
      }
    }
  }

  // ── JV_Color_Legend sheet (EXP-03; PRN-14: name + ref + hex, not color alone) ──
  const legend = wb.addWorksheet("JV_Color_Legend");
  legend.addRow(["Partner", "Reference", "Color"]).eachCell((c) => (c.font = { bold: true }));
  for (const key of orderedGroupKeys(groups, partners)) {
    if (key === UNMATCHED) continue;
    const p = partners.get(key);
    if (!p) continue;
    const row = legend.addRow([sanitizeCell(p.name), p.refId, p.color]); // SEC-06: partner name (F-26)
    const colorCell = row.getCell(3);
    colorCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(p.color) } };
    colorCell.font = { color: { argb: contrastText(p.color) } }; // PRN-14: hex text stays AA on its fill
  }

  return groups;
}

// exceljs types writeBuffer() against its own `Buffer`; return the raw bytes as a
// Uint8Array (a Buffer IS one at runtime) so callers avoid the @types/node Buffer clash.
async function writeWorkbook(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return (await wb.xlsx.writeBuffer()) as unknown as Uint8Array;
}

export async function renderExport(
  leads: readonly ExportLead[],
  partners: ReadonlyMap<string, PartnerInfo>,
  summary: RunSummary,
  options: RenderOptions,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  addLeadSheets(wb, leads, partners, options);

  // ── Run_Summary sheet (EXP-04; numbers from analytics, PRN-15) ──
  const sum = wb.addWorksheet("Run_Summary");
  sum.addRow(["Metric", "Value"]).eachCell((c) => (c.font = { bold: true }));
  sum.addRow(["Total leads", summary.total]);
  sum.addRow(["Kept", summary.kept]);
  sum.addRow(["Removed (MLS)", summary.removed]);
  sum.addRow(["Unmatched", summary.unmatched]);
  sum.addRow([]);
  sum.addRow(["Partner", "Distributed"]).eachCell((c) => (c.font = { bold: true }));
  for (const pp of summary.perPartner) {
    const p = partners.get(pp.partnerId);
    sum.addRow([sanitizeCell(p ? `${p.name} (${p.refId})` : pp.partnerId), pp.count]); // SEC-06: partner name (F-26)
  }

  return writeWorkbook(wb);
}

// ── Selection export (WP-N6, N6-40..44) ───────────────────────────────────────

/**
 * N6-42 — what the route knows and the renderer must not go looking for. The module stays
 * PURE (PRN-01): no `Date.now()`, no DB, no filter vocabulary lookups. `exportedAt` arrives
 * already formatted and `selection` already worded, so the same three strings render the same
 * workbook every time — which is what makes the TST-05 determinism check meaningful.
 *
 * Every field here is user-originated or user-adjacent and is sanitised at the write site
 * (SEC-06); the route sanitises nothing, so there is exactly one place this rule is applied.
 */
export interface SelectionMeta {
  /** The filter named in words (`describeFilters`), or "N selected by hand" for refs mode. */
  selection: string;
  /** The exporting seat's email. */
  exportedBy: string;
  /** A formatted timestamp — computed route-side. */
  exportedAt: string;
}

/**
 * N6-40/N6-41 — the operator's SELECTION as the fixed EXP-02 workbook. Identical Leads and
 * legend sheets to `renderExport` (same helper, same serializer chain); `Selection_Summary`
 * replaces `Run_Summary` because a selection has no run to summarise — the honest questions
 * are "which leads did this ask for", "how many", "who pulled it, and when".
 *
 * The per-partner tally is derived from the SAME grouping the Leads sheet rendered rather than
 * recomputed, so the summary can never disagree with the rows above it (PRN-15's instinct at
 * workbook scale).
 */
export async function renderSelectionExport(
  leads: readonly ExportLead[],
  partners: ReadonlyMap<string, PartnerInfo>,
  meta: SelectionMeta,
  options: RenderOptions,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const groups = addLeadSheets(wb, leads, partners, options);

  const sheet = wb.addWorksheet("Selection_Summary");
  sheet.addRow(["Metric", "Value"]).eachCell((c) => (c.font = { bold: true }));
  // SEC-06: the search term and any tag names ride inside `selection`, and `exportedBy` is an
  // address a seat typed — all three are user-originated text reaching a spreadsheet cell.
  sheet.addRow(["Selection", sanitizeCell(meta.selection)]);
  sheet.addRow(["Total exported", leads.length]);
  sheet.addRow(["Exported by", sanitizeCell(meta.exportedBy)]);
  sheet.addRow(["Exported at", sanitizeCell(meta.exportedAt)]);
  sheet.addRow([]);
  sheet.addRow(["Partner", "Leads"]).eachCell((c) => (c.font = { bold: true }));
  for (const key of orderedGroupKeys(groups, partners)) {
    sheet.addRow([sanitizeCell(partnerLabel(key === UNMATCHED ? null : key, partners)), groups.get(key)!.length]);
  }

  return writeWorkbook(wb);
}
