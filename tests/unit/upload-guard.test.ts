import { describe, expect, it } from "vitest";
import { validateUploadFile, MAX_UPLOAD_BYTES, MAX_UPLOAD_ROWS } from "@/lib/upload-guard";

// SEC-03: upload constraints — allowed extension + size cap (content-type is
// sniffed server-side; here we gate the obvious cases before parsing a 10 MB file).
describe("validateUploadFile", () => {
  it("SEC-03: accepts an .xlsx within the size cap", () => {
    expect(validateUploadFile({ name: "week.xlsx", size: 2_000_000 }).ok).toBe(true);
  });

  it("SEC-03: accepts .csv (case-insensitive extension)", () => {
    expect(validateUploadFile({ name: "WEEK.CSV", size: 100 }).ok).toBe(true);
  });

  it("SEC-03: rejects an unsupported extension", () => {
    const r = validateUploadFile({ name: "malware.exe", size: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/excel|csv/i);
  });

  it("SEC-03: rejects a file over the 10 MB cap", () => {
    const r = validateUploadFile({ name: "big.xlsx", size: MAX_UPLOAD_BYTES + 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/10 ?MB/i);
  });

  it("SEC-03: rejects an empty file", () => {
    expect(validateUploadFile({ name: "empty.xlsx", size: 0 }).ok).toBe(false);
  });

  it("has a sane server-side row cap", () => {
    expect(MAX_UPLOAD_ROWS).toBeGreaterThanOrEqual(10_000);
  });
});
