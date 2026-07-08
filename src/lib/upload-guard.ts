// SEC-03: upload constraints. Extension + size are checked client-side before we
// parse a potentially large file; the server sniffs content and caps row count.
// Kept dependency-free so both the browser and the API route can import it.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_UPLOAD_ROWS = 50_000;
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
