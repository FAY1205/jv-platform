import ExcelJS from "exceljs";
import type { RunSummary } from "../analytics/run-summary";

// ─────────────────────────────────────────────────────────────────────────────
// Export renderer (EXP-02..06, SEC-06, PRN-14). Deterministic transform:
// (leads, partners, summary, options) → xlsx bytes. No DB/fetch/Date.now (PRN-01).
// Determinism is verified SEMANTICALLY (reload + compare), never by byte-diff —
// the xlsx container embeds nondeterministic metadata. This is the TST-05 contract.
//
// SEC-06: every user-originated cell is sanitised against formula injection.
// PRN-14: partner name + JV-### ref accompany the color in every row and the
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
  "Previously Matched",
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
  previouslyMatched: boolean;
  possibleMlsListing: "yes" | "no" | "unknown" | "pending";
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

/** SEC-06: neutralise a cell that Excel would treat as a formula. */
function sanitizeCell(value: string): string {
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
 * an exceljs ARGB.
 */
export function contrastText(hex: string): "FF000000" | "FFFFFFFF" {
  const relLum = (h: string): number => {
    const c = h.replace(/^#/, "");
    const ch = [0, 2, 4]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a: string, b: string): number => {
    const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  return ratio("#000000", hex) >= ratio("#FFFFFF", hex) ? "FF000000" : "FFFFFFFF";
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
    lead.previouslyMatched ? "Yes" : "No",
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

export async function renderExport(
  leads: readonly ExportLead[],
  partners: ReadonlyMap<string, PartnerInfo>,
  summary: RunSummary,
  options: RenderOptions,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();

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

  // ── Run_Summary sheet (EXP-04; numbers from analytics, PRN-15) ──
  const sum = wb.addWorksheet("Run_Summary");
  sum.addRow(["Metric", "Value"]).eachCell((c) => (c.font = { bold: true }));
  sum.addRow(["Total leads", summary.total]);
  sum.addRow(["Kept", summary.kept]);
  sum.addRow(["Removed (MLS)", summary.removed]);
  sum.addRow(["Unmatched", summary.unmatched]);
  sum.addRow(["Previously matched", summary.previouslyMatched]);
  sum.addRow([]);
  sum.addRow(["Partner", "Distributed"]).eachCell((c) => (c.font = { bold: true }));
  for (const pp of summary.perPartner) {
    const p = partners.get(pp.partnerId);
    sum.addRow([sanitizeCell(p ? `${p.name} (${p.refId})` : pp.partnerId), pp.count]); // SEC-06: partner name (F-26)
  }

  // exceljs types writeBuffer() against its own `Buffer`; return the raw bytes as a
  // Uint8Array (a Buffer IS one at runtime) so callers avoid the @types/node Buffer clash.
  return (await wb.xlsx.writeBuffer()) as unknown as Uint8Array;
}
