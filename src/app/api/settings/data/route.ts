import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import { loadColorCoding, saveColorCoding, loadRetentionDays } from "@/modules/settings/export-settings";
import { listProfiles } from "@/modules/sources/profile-store";
import { jsonOk, jsonError } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// WS-7g: Data & Export settings — export color coding (SET-01/EXP-06/F-39), retention
// (SET-07, read-only), and the recognized file formats (Source Profiles, SET-12 —
// relocated here from Rules). Admin-only, scoped (PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "settings.manage");
    if (gate) return gate;
    const [colorCoding, retentionDays, formats] = await Promise.all([
      loadColorCoding(scope),
      loadRetentionDays(scope),
      listProfiles(getDb(), scope),
    ]);
    return jsonOk({ colorCoding, retentionDays, formats });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("data_settings_failed", "Could not load settings.", 500);
  }
}

const PutSchema = z.object({ colorCoding: z.boolean() });

export async function PUT(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "settings.manage");
    if (gate) return gate;
    const parsed = PutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    await saveColorCoding(scope, parsed.data.colorCoding);
    return jsonOk({ code: "ok", message: "Saved." });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("data_settings_save_failed", "Could not save.", 500);
  }
}
