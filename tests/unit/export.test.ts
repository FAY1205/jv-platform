import { describe, expect, it, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import {
  renderExport,
  EXPORT_COLUMNS,
  type ExportLead,
  type PartnerInfo,
} from "@/modules/export/render";
import type { RunSummary } from "@/modules/analytics/run-summary";

const PARTNERS = new Map<string, PartnerInfo>([
  ["p1", { id: "p1", name: "Randy Wolfe", refId: "JV-001", color: "#2E7D6F" }],
  ["p2", { id: "p2", name: "Josh Ax", refId: "JV-003", color: "#3B5BA5" }],
]);

function mk(over: Partial<ExportLead> & { leadRefId: string }): ExportLead {
  return {
    campaign: "Z",
    dateCreated: "2026-07-06",
    notes: "off market",
    address: "1 Main St",
    city: "Greenville",
    state: "SC",
    zip: "29601",
    sellerFirst: "Sam",
    sellerLast: "Rowe",
    phone: "864-555-0135",
    email: "sam@example.test",
    reasonForSelling: "Relocating",
    motivation: "High",
    timeToSell: "30 days",
    partnerId: "p1",
    previouslyMatched: false,
    possibleMlsListing: "unknown",
    ...over,
  };
}

const LEADS: ExportLead[] = [
  mk({ leadRefId: "LD-1", partnerId: "p1", notes: "=SUM(A1)" }), // SEC-06 formula injection
  mk({ leadRefId: "LD-2", partnerId: "p1", previouslyMatched: true }),
  mk({ leadRefId: "LD-3", partnerId: "p2", state: "NJ" }),
  mk({ leadRefId: "LD-4", partnerId: null, state: "CA", city: "Long Beach", zip: "90815" }), // unmatched
];

const SUMMARY: RunSummary = {
  total: 4,
  kept: 4,
  removed: 0,
  unmatched: 1,
  previouslyMatched: 1,
  perPartner: [
    { partnerId: "p1", count: 2 },
    { partnerId: "p2", count: 1 },
  ],
};

async function load(buf: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

function rowByLeadId(ws: ExcelJS.Worksheet, id: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => {
    if (String(row.getCell(1).value ?? "") === id) found = row;
  });
  return found;
}

describe("EXP-02/03: export structure", () => {
  let colorOn: ExcelJS.Workbook;
  beforeAll(async () => {
    colorOn = await load(await renderExport(LEADS, PARTNERS, SUMMARY, { colorCoding: true }));
  });

  it("EXP-02: the Leads header row is the fixed column contract in order", () => {
    const header = (colorOn.getWorksheet("Leads")!.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([...EXPORT_COLUMNS]);
  });

  it("EXP-03: a JV_Color_Legend and a Run_Summary sheet are present", () => {
    expect(colorOn.getWorksheet("JV_Color_Legend")).toBeDefined();
    expect(colorOn.getWorksheet("Run_Summary")).toBeDefined();
  });

  it("PRN-14: the JV Partner Name column carries name + JV-### (never color alone)", () => {
    const ws = colorOn.getWorksheet("Leads")!;
    const partnerCol = EXPORT_COLUMNS.indexOf("JV Partner Name") + 1;
    expect(rowByLeadId(ws, "LD-1")!.getCell(partnerCol).value).toBe("Randy Wolfe (JV-001)");
    expect(rowByLeadId(ws, "LD-4")!.getCell(partnerCol).value).toBe("Unmatched");
  });

  it("EXP-03: rows are grouped by partner (same-partner rows contiguous)", () => {
    const ws = colorOn.getWorksheet("Leads")!;
    const order: string[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const id = String(row.getCell(1).value ?? "");
      if (id.startsWith("LD-")) order.push(id);
    });
    // p1 group (LD-1, LD-2) then p2 (LD-3) then unmatched (LD-4).
    expect(order).toEqual(["LD-1", "LD-2", "LD-3", "LD-4"]);
  });

  it("SEC-06: a formula-injecting cell is neutralised (no leading = + - @)", () => {
    const ws = colorOn.getWorksheet("Leads")!;
    const notesCol = EXPORT_COLUMNS.indexOf("Notes") + 1;
    const value = String(rowByLeadId(ws, "LD-1")!.getCell(notesCol).value);
    expect(value.startsWith("=")).toBe(false);
    expect(value).toContain("SUM(A1)"); // content preserved, just de-fanged
  });

  it("Run_Summary carries the totals from computeRunSummary", () => {
    const ws = colorOn.getWorksheet("Run_Summary")!;
    const byLabel = new Map<string, unknown>();
    ws.eachRow((row) => byLabel.set(String(row.getCell(1).value ?? ""), row.getCell(2).value));
    expect(byLabel.get("Total leads")).toBe(4);
    expect(byLabel.get("Unmatched")).toBe(1);
    expect(byLabel.get("Previously matched")).toBe(1);
  });
});

describe("F-26: partner-name cells are formula-sanitized on every path", () => {
  const EVIL = new Map<string, PartnerInfo>([["evil", { id: "evil", name: "=cmd()|Acme", refId: "JV-009", color: "#2E7D6F" }]]);
  const EVIL_LEADS: ExportLead[] = [mk({ leadRefId: "LD-9", partnerId: "evil" })];
  const EVIL_SUMMARY: RunSummary = { total: 1, kept: 1, removed: 0, unmatched: 0, previouslyMatched: 0, perPartner: [{ partnerId: "evil", count: 1 }] };

  it("F-26: the legend + summary partner-name cells are neutralised", async () => {
    const wb = await load(await renderExport(EVIL_LEADS, EVIL, EVIL_SUMMARY, { colorCoding: true }));
    const legendName = String(wb.getWorksheet("JV_Color_Legend")!.getRow(2).getCell(1).value);
    expect(legendName.startsWith("=")).toBe(false);
    expect(legendName).toContain("cmd()|Acme");
    const sum = wb.getWorksheet("Run_Summary")!;
    let summaryPartner: string | undefined;
    sum.eachRow((row) => {
      const v = String(row.getCell(1).value ?? "");
      if (v.includes("cmd()|Acme")) summaryPartner = v;
    });
    expect(summaryPartner).toBeDefined();
    expect(summaryPartner!.startsWith("=")).toBe(false);
  });

  it("F-26: the color-OFF group-header partner name is neutralised", async () => {
    const ws = (await load(await renderExport(EVIL_LEADS, EVIL, EVIL_SUMMARY, { colorCoding: false }))).getWorksheet("Leads")!;
    let header: string | undefined;
    ws.eachRow((row) => {
      const c = row.getCell(1);
      if (c.font?.bold && String(c.value ?? "").includes("cmd()|Acme")) header = String(c.value);
    });
    expect(header).toBeDefined();
    expect(header!.startsWith("=")).toBe(false);
  });
});

describe("EXP-06: color ON/OFF toggle", () => {
  it("color ON fills data rows with the locked partner color + sets a font color (AA)", async () => {
    const ws = (await load(await renderExport(LEADS, PARTNERS, SUMMARY, { colorCoding: true }))).getWorksheet(
      "Leads",
    )!;
    const cell = rowByLeadId(ws, "LD-1")!.getCell(1);
    expect(cell.fill).toMatchObject({ type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D6F" } });
    expect(cell.font?.color?.argb).toMatch(/^FF(000000|FFFFFF)$/);
  });

  it("color OFF uses no fills and a bold partner group-header row instead", async () => {
    const ws = (await load(await renderExport(LEADS, PARTNERS, SUMMARY, { colorCoding: false }))).getWorksheet(
      "Leads",
    )!;
    // Data row has no fill.
    expect(rowByLeadId(ws, "LD-1")!.getCell(1).fill).toBeUndefined();
    // A bold group-header row names the partner (name + ref).
    let headerText: string | undefined;
    ws.eachRow((row) => {
      const c = row.getCell(1);
      if (c.font?.bold && String(c.value ?? "").includes("Randy Wolfe (JV-001)")) {
        headerText = String(c.value);
      }
    });
    expect(headerText).toBe("Randy Wolfe (JV-001)");
  });
});
