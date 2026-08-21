import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  EXPORT_COLUMNS,
  renderSelectionExport,
  SELECTION_EXPORT_SCOPE_NOTE,
  sanitizeCell,
  type ExportLead,
  type PartnerInfo,
  type SelectionMeta,
} from "@/modules/export/render";

// ─────────────────────────────────────────────────────────────────────────────
// WP-N6 T-7 — the selection workbook (N6-41/N6-42): the EXP-02 column order, the
// `Selection_Summary` sheet that replaces `Run_Summary`, and SEC-06 on BOTH the lead rows and
// the new summary cells.
//
// Determinism is checked SEMANTICALLY — render twice, reload, compare the cell values — never
// by byte-diff. The xlsx container embeds nondeterministic metadata, so a byte comparison
// would fail on every run for reasons that have nothing to do with the contract (TST-05).
// ─────────────────────────────────────────────────────────────────────────────

const PARTNERS = new Map<string, PartnerInfo>([
  ["p1", { id: "p1", name: "Alpha", refId: "JV-001", color: "#f4c95d" }],
  ["p2", { id: "p2", name: "Bravo", refId: "JV-002", color: "#5e9e8e" }],
]);

const lead = (over: Partial<ExportLead>): ExportLead => ({
  leadRefId: "LD-26-00001",
  campaign: "Weekly",
  dateCreated: "2026-08-01",
  notes: "",
  address: "18 Palo Verde Rd",
  city: "Phoenix",
  state: "AZ",
  zip: "85004",
  sellerFirst: "Dana",
  sellerLast: "Reyes",
  phone: "602-555-0100",
  email: "dana@example.test",
  reasonForSelling: "Relocating",
  motivation: "High",
  timeToSell: "30 days",
  partnerId: "p1",
  possibleMlsListing: "no",
  ...over,
});

const META: SelectionMeta = {
  selection: "Hot only",
  exportedBy: "ops@example.test",
  exportedAt: "2026-08-21 09:30:00 UTC",
};

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

/** Every sheet flattened to `sheet!row!col = value` — the semantic content of the workbook,
 *  independent of the container's metadata. */
function cellMap(wb: ExcelJS.Workbook): Record<string, string> {
  const out: Record<string, string> = {};
  wb.eachSheet((sheet) => {
    sheet.eachRow((row, r) => row.eachCell((cell, c) => (out[`${sheet.name}!${r}!${c}`] = String(cell.value))));
  });
  return out;
}

function rowValues(sheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  const out: string[] = [];
  sheet.getRow(rowNumber).eachCell((cell) => out.push(String(cell.value)));
  return out;
}

/** The `Selection_Summary` sheet as a metric → value lookup. */
function summaryOf(wb: ExcelJS.Workbook): Map<string, string> {
  const sheet = wb.getWorksheet("Selection_Summary")!;
  const out = new Map<string, string>();
  sheet.eachRow((row) => {
    const [k, v] = [row.getCell(1).value, row.getCell(2).value];
    if (k !== null && v !== null && v !== undefined) out.set(String(k), String(v));
  });
  return out;
}

describe("N6-41/N6-42: renderSelectionExport", () => {
  it("N6-41/EXP-02: the Leads sheet keeps the fixed 18-column order", async () => {
    const wb = await load(await renderSelectionExport([lead({})], PARTNERS, META, { colorCoding: true }));
    expect(rowValues(wb.getWorksheet("Leads")!, 1)).toEqual([...EXPORT_COLUMNS]);
    expect(EXPORT_COLUMNS.length).toBe(18);
  });

  it("N6-42: Selection_Summary replaces Run_Summary and carries who / when / what / how many", async () => {
    const bytes = await renderSelectionExport(
      [lead({}), lead({ leadRefId: "LD-26-00002" }), lead({ leadRefId: "LD-26-00003", partnerId: "p2" }), lead({ leadRefId: "LD-26-00004", partnerId: null })],
      PARTNERS,
      META,
      { colorCoding: false },
    );
    const wb = await load(bytes);
    expect(wb.getWorksheet("Run_Summary")).toBeUndefined();
    expect(wb.getWorksheet("JV_Color_Legend")).toBeDefined();

    const summary = summaryOf(wb);
    // tenancy F-6: the first row says what KIND of workbook this is. The file is otherwise
    // indistinguishable from the partner deliverable admins forward.
    expect(summary.get("Scope")).toBe(SELECTION_EXPORT_SCOPE_NOTE);
    expect(summary.get("Selection")).toBe("Hot only");
    expect(summary.get("Total exported")).toBe("4");
    expect(summary.get("Exported by")).toBe("ops@example.test");
    expect(summary.get("Exported at")).toBe("2026-08-21 09:30:00 UTC");
    // Per-partner counts, in the workbook's own group order (partners by refId, Unmatched last).
    expect(summary.get("Alpha (JV-001)")).toBe("2");
    expect(summary.get("Bravo (JV-002)")).toBe("1");
    expect(summary.get("Unmatched")).toBe("1");
  });

  it("N6-42/SEC-06: a formula-prefixed seller name AND a formula-prefixed filter q are both neutralised", async () => {
    const hostile = "=SUM(A1:A9)";
    const wb = await load(
      await renderSelectionExport(
        [lead({ sellerLast: hostile })],
        PARTNERS,
        // The `q` the operator typed reaches the sheet inside the filter sentence — the one
        // user-originated string in this workbook that no LEAD row ever carries.
        { ...META, selection: `search “${hostile}”`, exportedBy: `+ops@example.test` },
        { colorCoding: false },
      ),
    );

    const leads = wb.getWorksheet("Leads")!;
    // The lead row: `sellerLast` is column 11 of the fixed order.
    const cells: string[] = [];
    leads.eachRow((row) => row.eachCell((c) => cells.push(String(c.value))));
    expect(cells).toContain(`'${hostile}`);
    expect(cells).not.toContain(hostile);

    const summary = summaryOf(wb);
    // The sentence does not START with `=`, so it passes through — but the address does start
    // with `+`, which Excel treats identically. Both legs matter: the guard is the character
    // class, not "does it look like a formula".
    expect(summary.get("Selection")).toBe(`search “${hostile}”`);
    expect(summary.get("Exported by")).toBe("'+ops@example.test");
  });

  it("SEC-06: sanitizeCell is exported so the summary cells use the SAME rule as the lead rows", () => {
    // N6-42 made this module-private helper part of the contract. Pinned directly: a future
    // narrowing of the character class must break here, not silently in one sheet.
    for (const prefix of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(sanitizeCell(`${prefix}cmd`)).toBe(`'${prefix}cmd`);
    }
    expect(sanitizeCell("Reyes")).toBe("Reyes");
  });

  it("TST-05: two renders of the same selection are semantically identical", async () => {
    const leads = [lead({}), lead({ leadRefId: "LD-26-00002", partnerId: "p2" }), lead({ leadRefId: "LD-26-00003", partnerId: null })];
    const [a, b] = await Promise.all([
      renderSelectionExport(leads, PARTNERS, META, { colorCoding: true }),
      renderSelectionExport(leads, PARTNERS, META, { colorCoding: true }),
    ]);
    expect(cellMap(await load(a))).toEqual(cellMap(await load(b)));
  });
});
