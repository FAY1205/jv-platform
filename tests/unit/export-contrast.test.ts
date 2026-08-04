import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { contrastText, renderExport, type ExportLead, type PartnerInfo } from "@/modules/export/render";
import { PARTNER_SWATCHES } from "@/lib/tokens/tokens";
import { contrastRatio } from "@/lib/contrast";
import type { RunSummary } from "@/modules/analytics/run-summary";

// WP-H / CON-01: AA assertions use the shared contrastRatio primitive (SC 1.4.3),
// independently pinned to WebAIM reference values by wcag.test.ts. argbToHex converts an
// exceljs ARGB (FFRRGGBB) → #RRGGBB for the ratio call.
const argbToHex = (argb: string) => "#" + argb.slice(2);

describe("EXP-06/PRN-14: export text meets WCAG AA on every partner tint", () => {
  it("contrastText picks an AA (>=4.5:1) ink for all 20 swatches", () => {
    for (const swatch of PARTNER_SWATCHES) {
      const ink = argbToHex(contrastText(swatch));
      expect(contrastRatio(ink, swatch), `swatch ${swatch}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("legend color cells + color-ON rows carry an AA font color for a dark tint", async () => {
    const dark = "#7A3B45"; // wine — black default text would be ~2.5:1
    const partners = new Map<string, PartnerInfo>([["p1", { id: "p1", name: "Wine Co", refId: "JV-777", color: dark }]]);
    const leads: ExportLead[] = [
      {
        leadRefId: "LD-1",
        campaign: "Z",
        dateCreated: "2026-07-06",
        notes: "",
        address: "1 A St",
        city: "Greenville",
        state: "SC",
        zip: "29601",
        sellerFirst: "S",
        sellerLast: "R",
        phone: "",
        email: "",
        reasonForSelling: "",
        motivation: "",
        timeToSell: "",
        partnerId: "p1",
        previouslyMatched: false,
        possibleMlsListing: "unknown",
      },
    ];
    const summary: RunSummary = { total: 1, kept: 1, removed: 0, unmatched: 0, previouslyMatched: 0, perPartner: [{ partnerId: "p1", count: 1 }] };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderExport(leads, partners, summary, { colorCoding: true })) as unknown as ArrayBuffer);

    const legendCell = wb.getWorksheet("JV_Color_Legend")!.getRow(2).getCell(3);
    expect(contrastRatio(argbToHex(String(legendCell.font!.color!.argb)), dark)).toBeGreaterThanOrEqual(4.5);

    const leadsWs = wb.getWorksheet("Leads")!;
    let dataCellArgb: string | undefined;
    leadsWs.eachRow((row) => {
      if (String(row.getCell(1).value ?? "") === "LD-1") dataCellArgb = String(row.getCell(1).font?.color?.argb);
    });
    expect(contrastRatio(argbToHex(dataCellArgb!), dark)).toBeGreaterThanOrEqual(4.5);
  });
});
