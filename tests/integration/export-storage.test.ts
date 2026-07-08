import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { storeExport, signedExportUrl, EXPORTS_BUCKET, exportStoragePath } from "@/modules/export/storage";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const suite = supabaseUrl && serviceKey ? describe : describe.skip;

suite("WP-028b: export storage + signed URL (EXP-05, SEC-02)", () => {
  // Created in beforeAll (not the describe body) so a skipped suite never calls
  // createClient with an absent URL (which throws at collection time).
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createClient(supabaseUrl!, serviceKey!, { auth: { autoRefreshToken: false, persistSession: false } });
  });
  const tenantId = `test-${randomUUID()}`;
  const uploadRef = "UP-2026-999";
  const bytes = new TextEncoder().encode("PK fake-xlsx-content for the round-trip test");

  it("EXP-05: stores the deliverable and a signed URL downloads the exact bytes back", async () => {
    const path = await storeExport(admin, { tenantId, uploadRef, bytes });
    expect(path).toBe(exportStoragePath(tenantId, uploadRef));

    const url = await signedExportUrl(admin, path, `${uploadRef}.xlsx`);
    expect(url).toContain("/storage/v1/");
    expect(url).toContain("token="); // SEC-02: it's a signed (tokened) URL, not a public path

    const res = await fetch(url);
    expect(res.status).toBe(200);
    const back = new Uint8Array(await res.arrayBuffer());
    expect(back).toEqual(bytes);

    // SEC-02: the bucket is private — the unsigned public URL must NOT serve the file.
    const publicUrl = admin.storage.from(EXPORTS_BUCKET).getPublicUrl(path).data.publicUrl;
    const pub = await fetch(publicUrl);
    expect(pub.ok).toBe(false);

    await admin.storage.from(EXPORTS_BUCKET).remove([path]);
  });
});
