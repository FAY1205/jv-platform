import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { renderExport, type ExportLead, type PartnerInfo } from "@/modules/export/render";
import type { RunSummary } from "@/modules/analytics/run-summary";

// EXP-04 / D5: the Run_Summary sheet's per-partner header uses the "Distributed"
// vocabulary, not "Delivered".
describe("renderExport — Run_Summary sheet (EXP-04, D5)", () => {
  it("D5: the per-partner totals header reads 'Distributed', not 'Delivered'", async () => {
    const partners = new Map<string, PartnerInfo>([
      ["p1", { id: "p1", name: "Alpha", refId: "JV-001", color: "#f4c95d" }],
    ]);
    const summary: RunSummary = { total: 2, kept: 1, removed: 1, unmatched: 0, previouslyMatched: 0, perPartner: [{ partnerId: "p1", count: 1 }] };
    const leads: ExportLead[] = [];
    const bytes = await renderExport(leads, partners, summary, { colorCoding: false });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Run_Summary")!;
    const cells: string[] = [];
    sheet.eachRow((row) => row.eachCell((c) => cells.push(String(c.value))));
    expect(cells).toContain("Distributed");
    expect(cells).not.toContain("Delivered");
  });
});
