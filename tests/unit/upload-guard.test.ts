import { describe, expect, it } from "vitest";
import {
  validateUploadFile,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_ROWS,
  MAX_UPLOAD_BODY_BYTES,
  exceedsBodyLimit,
  parseContentLength,
} from "@/lib/upload-guard";

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

// F-86: reject an oversize JSON upload body from Content-Length before req.json().
describe("F-86: upload body-size guard", () => {
  it("parses a positive Content-Length and rejects garbage/missing as null", () => {
    expect(parseContentLength("1024")).toBe(1024);
    expect(parseContentLength(null)).toBeNull();
    expect(parseContentLength("")).toBeNull();
    expect(parseContentLength("-5")).toBeNull();
    expect(parseContentLength("abc")).toBeNull();
  });

  it("flags a body over the ceiling and passes one at/under it", () => {
    expect(exceedsBodyLimit(MAX_UPLOAD_BODY_BYTES + 1)).toBe(true);
    expect(exceedsBodyLimit(MAX_UPLOAD_BODY_BYTES)).toBe(false);
    expect(exceedsBodyLimit(1024)).toBe(false);
  });

  it("does NOT reject an unknown (null) length — the row cap is the backstop", () => {
    expect(exceedsBodyLimit(null)).toBe(false);
  });
});
