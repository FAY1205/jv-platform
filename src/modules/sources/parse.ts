import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// Workbook reader (ING-01). SheetJS parses the uploaded .xlsx/.csv bytes into a
// header row + row objects. Cells are read as FORMATTED STRINGS ({ raw: false })
// so leading-zero ZIPs survive (NRM-01) and dates arrive as their displayed text
// rather than Excel serials. Deterministic over its input bytes.
//
// File contents are DATA (PRN-10) — never evaluated or trusted as instructions.
// Runs off the main thread via src/workers/xlsx.worker.ts (FEP-06); this helper is
// the pure, worker-free core so it is unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedWorkbook {
  /** The first sheet's header row, in original order. */
  headers: string[];
  /** Data rows as objects keyed by header (blank cells → ""), in file order. */
  rows: Record<string, string>[];
}

export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParsedWorkbook {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = XLSX.read(bytes, { type: "array", cellDates: false });

  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return { headers: [], rows: [] };

  // header:1 → array-of-arrays; raw:false → formatted text; defval:"" → keep blanks.
  const matrix = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[firstSheet], {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  const headerRow = matrix[0];
  if (!headerRow || headerRow.length === 0) return { headers: [], rows: [] };
  const headers = headerRow.map((h) => String(h ?? "").trim());

  const rows = matrix.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = String(cells[i] ?? "");
    });
    return row;
  });

  return { headers, rows };
}
