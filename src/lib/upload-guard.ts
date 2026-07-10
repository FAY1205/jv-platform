// SEC-03: upload constraints. Extension + size are checked client-side before we
// parse a potentially large file; the server sniffs content and caps row count.
// Kept dependency-free so both the browser and the API route can import it.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_UPLOAD_ROWS = 50_000;
// F-86: the upload route receives the PARSED rows as a JSON body, not the file — that
// body expands past the 10 MB file cap (JSON keys + per-cell overhead). This ceiling
// lets a route reject an absurdly large body from its Content-Length BEFORE req.json()
// buys a giant in-memory parse; the MAX_UPLOAD_ROWS Zod cap is the exact backstop once
// parsed. Sized generously above a full 50k-row JSON payload.
export const MAX_UPLOAD_BODY_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_EXTENSIONS = [".xlsx", ".csv"] as const;

export interface UploadFileMeta {
  name: string;
  size: number;
}

export interface UploadValidation {
  ok: boolean;
  error?: string;
}

/** Validate a chosen file's extension + size before parsing (SEC-03). */
export function validateUploadFile(file: UploadFileMeta): UploadValidation {
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return { ok: false, error: "Please choose an Excel (.xlsx) or CSV file." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "That file is empty." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is larger than the 10 MB limit." };
  }
  return { ok: true };
}

/** Parse a request's Content-Length header into a positive integer, or null when it
 *  is missing/unparseable (a value we can't pre-check). */
export function parseContentLength(header: string | null): number | null {
  if (!header) return null;
  const n = Number(header);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** F-86: true when a KNOWN Content-Length exceeds the body ceiling — reject early
 *  (413) before parsing. A null (unknown) length is not treated as over-limit; the
 *  MAX_UPLOAD_ROWS cap stays the backstop once the body is parsed. */
export function exceedsBodyLimit(contentLength: number | null): boolean {
  return contentLength !== null && contentLength > MAX_UPLOAD_BODY_BYTES;
}
