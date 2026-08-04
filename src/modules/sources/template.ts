import ExcelJS from "exceljs";
import { CANONICAL_FIELDS, type CanonicalField, type SourceProfile } from "./types";

// ING-05: a downloadable template for a Source Profile — the exact expected headers
// plus one example row. `templateRows` is PURE (unit-tested); `renderTemplate` wraps
// it in an .xlsx. The example only fills columns that map to a canonical field.

const SAMPLE_BY_FIELD: Record<CanonicalField, string> = {
  campaign: "Spring Mailer",
  dateCreated: "2026-07-01",
  notes: "Is it Listed? : No",
  address: "123 Main St",
  city: "Dallas",
  state: "TX",
  zip: "75001",
  sellerFirst: "Jane",
  sellerLast: "Doe",
  phone: "555-0100",
  email: "jane@example.com",
  reasonForSelling: "Relocating",
  motivation: "High",
  timeToSell: "30 days",
};

export interface TemplateRows {
  headers: string[];
  example: string[];
}

/** Headers = the profile's signature; example row fills each mapped canonical column. */
export function templateRows(profile: SourceProfile): TemplateRows {
  // Reverse the mapping: source column header → canonical field.
  const fieldByHeader = new Map<string, CanonicalField>();
  for (const field of CANONICAL_FIELDS) {
    const header = profile.mapping[field];
    if (header) fieldByHeader.set(header, field);
  }
  const headers = [...profile.headerSignature];
  const example = headers.map((h) => {
    const field = fieldByHeader.get(h);
    return field ? SAMPLE_BY_FIELD[field] : "";
  });
  return { headers, example };
}

/** Render the template as an .xlsx (header row + one example row). */
export async function renderTemplate(profile: SourceProfile): Promise<Uint8Array> {
  const { headers, example } = templateRows(profile);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Template");
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true };
  // Write every cell as an explicit string (SEC-06 posture: never a formula).
  ws.addRow(example).eachCell((cell) => {
    cell.value = String(cell.value ?? "");
  });
  ws.columns.forEach((c) => {
    c.width = 18;
  });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
