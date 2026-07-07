import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "@/modules/sources/parse";

/** Build an in-memory .xlsx byte buffer from an array-of-arrays. */
function makeXlsx(aoa: (string | number)[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

describe("ING-01/FEP-06: parseWorkbook", () => {
  it("extracts the header row and row objects keyed by header", () => {
    const buf = makeXlsx([
      ["Campaign", "Zip Code", "Notes"],
      ["Real Estate Bees", "08034", "Is it Listed? : No"],
    ]);
    const { headers, rows } = parseWorkbook(buf);
    expect(headers).toEqual(["Campaign", "Zip Code", "Notes"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].Campaign).toBe("Real Estate Bees");
    expect(rows[0].Notes).toBe("Is it Listed? : No");
  });

  it("NRM-01: preserves a leading-zero ZIP stored as text", () => {
    const buf = makeXlsx([["Zip Code"], ["06404"]]);
    expect(parseWorkbook(buf).rows[0]["Zip Code"]).toBe("06404");
  });

  it("keeps a blank mapped cell as an empty string (defval), not undefined", () => {
    const buf = makeXlsx([
      ["Zip Code", "Notes"],
      ["08034", ""],
    ]);
    const { rows } = parseWorkbook(buf);
    expect(rows[0].Notes).toBe("");
    expect("Notes" in rows[0]).toBe(true);
  });

  it("is deterministic: same bytes ⇒ same parse (PRN-01-adjacent)", () => {
    const buf = makeXlsx([
      ["A", "B"],
      ["1", "2"],
    ]);
    expect(parseWorkbook(buf)).toEqual(parseWorkbook(buf));
  });

  it("returns empty headers/rows for an empty workbook", () => {
    expect(parseWorkbook(makeXlsx([]))).toEqual({ headers: [], rows: [] });
  });
});
