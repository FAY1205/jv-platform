import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { loadColorCoding, saveColorCoding, loadRetentionDays, loadVoidNotifiesPartners, saveVoidNotifiesPartners } from "@/modules/settings/export-settings";
import { listProfiles } from "@/modules/sources/profile-store";
import { jsonOk, jsonError } from "@/lib/http";

// WS-7g: Data & Export settings — export color coding (SET-01/EXP-06/F-39), retention
// (SET-07, read-only), and the recognized file formats (Source Profiles, SET-12 —
// relocated here from Rules). Admin-only, scoped (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const [colorCoding, retentionDays, voidNotifiesPartners, formats] = await Promise.all([
      loadColorCoding(scope),
      loadRetentionDays(scope),
      loadVoidNotifiesPartners(scope),
      listProfiles(getDb(), scope),
    ]);
    return jsonOk({ colorCoding, retentionDays, voidNotifiesPartners, formats });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("data_settings_failed", "Could not load settings.", 500);
  }
}

const PutSchema = z
  .object({ colorCoding: z.boolean().optional(), voidNotifiesPartners: z.boolean().optional() })
  .refine((v) => v.colorCoding !== undefined || v.voidNotifiesPartners !== undefined, "No setting provided.");

export async function PUT(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const parsed = PutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    if (parsed.data.colorCoding !== undefined) await saveColorCoding(scope, parsed.data.colorCoding);
    if (parsed.data.voidNotifiesPartners !== undefined) await saveVoidNotifiesPartners(scope, parsed.data.voidNotifiesPartners);
    return jsonOk({ code: "ok", message: "Saved." });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("data_settings_save_failed", "Could not save.", 500);
  }
}
