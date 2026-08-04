import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Export storage (EXP-05, SEC-02). The rendered deliverable .xlsx is stored in a
// PRIVATE bucket (never public); downloads go through a short-lived signed URL.
// All calls use the service-role admin client server-side only.
// ─────────────────────────────────────────────────────────────────────────────

export const EXPORTS_BUCKET = "run-exports";
export const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Deterministic per-tenant path for a run's stored deliverable. Pure. */
export function exportStoragePath(tenantId: string, uploadRef: string): string {
  return `${tenantId}/${uploadRef}.xlsx`;
}

/** Create the private exports bucket if it doesn't exist yet (idempotent). */
export async function ensureExportsBucket(admin: SupabaseClient): Promise<void> {
  const { data } = await admin.storage.getBucket(EXPORTS_BUCKET);
  if (data) return;
  const { error } = await admin.storage.createBucket(EXPORTS_BUCKET, { public: false });
  // A concurrent create (or a race with getBucket) is fine — only re-throw otherwise.
  if (error && !/already exists/i.test(error.message)) throw error;
}

/** Store a run's rendered .xlsx and return its storage path (EXP-05). */
export async function storeExport(
  admin: SupabaseClient,
  input: { tenantId: string; uploadRef: string; bytes: Uint8Array },
): Promise<string> {
  await ensureExportsBucket(admin);
  const path = exportStoragePath(input.tenantId, input.uploadRef);
  const { error } = await admin.storage
    .from(EXPORTS_BUCKET)
    .upload(path, input.bytes, { contentType: XLSX_CONTENT_TYPE, upsert: true });
  if (error) throw error;
  return path;
}

/** A short-lived signed download URL for a stored export (SEC-02). */
export async function signedExportUrl(
  admin: SupabaseClient,
  path: string,
  downloadName: string,
  ttlSeconds = SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const { data, error } = await admin.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(path, ttlSeconds, { download: downloadName });
  if (error || !data?.signedUrl) throw error ?? new Error("Could not sign the export URL.");
  return data.signedUrl;
}
