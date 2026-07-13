import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { jsonOk, jsonError } from "@/lib/http";
import { loadAiSettings, saveAiSettings } from "@/modules/ai/settings";
import { monthToDateMicroUsd } from "@/modules/ai/usage";
import { z } from "zod";

// SET-11: read + update the tenant's AI assistant settings (enabled + monthly
// cap), plus month-to-date spend for the settings panel. Admin-only.
const PutSchema = z.object({ enabled: z.boolean(), capUsd: z.number().positive().max(1000) });

export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const [settings, spentMicroUsd] = await Promise.all([loadAiSettings(scope), monthToDateMicroUsd(getDb(), scope, new Date())]);
    return jsonOk({ settings, usage: { spentMicroUsd, spentUsd: Math.round(spentMicroUsd / 10_000) / 100 } });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("ai_settings_failed", "Could not load AI settings.", 500);
  }
}

export async function PUT(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const parsed = PutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", "Invalid AI settings.", 400);
    await saveAiSettings(scope, parsed.data);
    return jsonOk({ code: "ok", message: "AI settings saved.", settings: await loadAiSettings(scope) });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("ai_settings_save_failed", "Could not save AI settings.", 500);
  }
}
