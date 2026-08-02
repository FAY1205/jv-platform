import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { jsonOk, jsonError } from "@/lib/http";
import { loadAiSettings, saveAiSettings } from "@/modules/ai/settings";
import { aiCredentialStatus, saveAiCredential, clearAiCredential, AI_PROVIDERS } from "@/modules/ai/credential";
import { monthToDateMicroUsd } from "@/modules/ai/usage";
import { z } from "zod";

// SET-11 / ADR-0036: read + update the tenant's AI assistant settings — the enable
// switch AND the BYO provider credential (write-only key). Plus month-to-date usage
// (read-only estimate) for the panel. The monthly spend cap was removed — tenants
// cap spend in their own provider dashboard. Admin-only.
const PutSchema = z.object({ enabled: z.boolean() });
// The credential PUT: set a provider + key, or clear it. The key is never echoed back.
const CredentialSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), provider: z.enum(AI_PROVIDERS), apiKey: z.string().trim().min(8).max(500) }),
  z.object({ action: z.literal("clear") }),
]);

export async function GET() {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const [settings, credential, spentMicroUsd] = await Promise.all([
      loadAiSettings(scope),
      aiCredentialStatus(scope),
      monthToDateMicroUsd(getDb(), scope, new Date()),
    ]);
    return jsonOk({ settings, credential, usage: { spentMicroUsd, spentUsd: Math.round(spentMicroUsd / 10_000) / 100 } });
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

// ADR-0036: set or clear the tenant's provider API key. Separate verb so the key
// never rides along with the enabled/allowance save and is never returned.
export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const parsed = CredentialSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid credential.", 400);
    if (parsed.data.action === "clear") {
      await clearAiCredential(scope);
      return jsonOk({ code: "ok", message: "API key removed.", credential: await aiCredentialStatus(scope) });
    }
    if (!(await aiCredentialStatus(scope)).encryptionAvailable) {
      return jsonError("encryption_unavailable", "Key storage isn't configured yet — contact support.", 503);
    }
    await saveAiCredential(scope, { provider: parsed.data.provider, apiKey: parsed.data.apiKey });
    return jsonOk({ code: "ok", message: "API key saved.", credential: await aiCredentialStatus(scope) });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("ai_credential_save_failed", "Could not save the API key.", 500);
  }
}
