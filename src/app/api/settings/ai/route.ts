import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, assertCsrf } from "@/lib/auth/guard";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";
import { clientIp } from "@/lib/auth/client-ip";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { AI_CREDENTIAL_TEST_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";
import { loadAiSettings, saveAiSettings } from "@/modules/ai/settings";
import { aiCredentialStatus, saveAiCredential, clearAiCredential, setAiCredentialModel, AI_PROVIDERS } from "@/modules/ai/credential";
import { testAiCredential } from "@/modules/ai/credential-test";
import { isValidModel } from "@/modules/ai/models-catalog";
import { z } from "zod";
import { requireCapabilityResponse } from "@/lib/authz";

const AI_CREDENTIAL_TEST_KIND = "ai_credential_test";

// SET-11 / ADR-0036: read + update the tenant's AI assistant settings — the enable
// switch AND the BYO provider credential (write-only key). The monthly spend cap and
// the usage estimate were removed — tenants cap spend in their own provider dashboard.
// Admin-only.
const PutSchema = z.object({ enabled: z.boolean() });
// The credential POST: set a provider + key + model, change only the model, clear it,
// or test the stored key against the live provider. The key is never echoed back.
const CredentialSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), provider: z.enum(AI_PROVIDERS), apiKey: z.string().trim().min(8).max(500), model: z.string().min(1).max(100) }),
  z.object({ action: z.literal("set-model"), model: z.string().min(1).max(100) }),
  z.object({ action: z.literal("clear") }),
  z.object({ action: z.literal("test") }),
]);

export async function GET() {
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "settings.manage");
    if (gate) return gate;
    const [settings, credential] = await Promise.all([loadAiSettings(scope), aiCredentialStatus(scope)]);
    return jsonOk({ settings, credential });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("ai_settings_failed", "Could not load AI settings.", 500);
  }
}

export async function PUT(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "settings.manage");
    if (gate) return gate;
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
    const gate = requireCapabilityResponse(scope, "settings.manage");
    if (gate) return gate;
    const parsed = CredentialSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid credential.", 400);
    if (parsed.data.action === "test") {
      // AUT-03 (audit R-60): the "test" action makes a live provider call on the BYO key.
      // Throttle it (per-tenant cooldown + per-IP) so it can't be used as a fast key-validity
      // oracle or a spend vector. Sliding-window only (reserve -> snapshot -> decide), like the
      // other post-auth guards. Keyed on the tenant.
      const ip = clientIp(request);
      const now = Date.now();
      const attempts = new AuthAttemptsStore(getDb());
      const attemptId = await attempts.reserve(scope.tenantId, ip, AI_CREDENTIAL_TEST_KIND);
      const snap = await attempts.snapshot(scope.tenantId, ip, AI_CREDENTIAL_TEST_KIND, now, AI_CREDENTIAL_TEST_THROTTLE);
      const byTenant = rateDecisionWithSelf(snap.attempts, now, AI_CREDENTIAL_TEST_THROTTLE.perIdentifier);
      const byIp = rateDecisionWithSelf(snap.ipAttempts, now, AI_CREDENTIAL_TEST_THROTTLE.perIp);
      if (!byTenant.allowed || !byIp.allowed) {
        const retryAfterSec = Math.ceil(Math.max(byTenant.retryAfterMs, byIp.retryAfterMs) / 1000);
        return NextResponse.json(
          { code: "too_many_requests", message: "Too many key tests. Please wait a moment and try again.", traceId: newTraceId() },
          { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
        );
      }
      // Live check of the STORED key — makes one tiny provider call and reports a
      // precise reason. Always 200; the outcome is in `test.ok`.
      let ok = false;
      try {
        const test = await testAiCredential(scope);
        ok = test.ok;
        return jsonOk({ code: "ok", test });
      } finally {
        await attempts.settle(attemptId, ok);
      }
    }
    if (parsed.data.action === "clear") {
      await clearAiCredential(scope);
      return jsonOk({ code: "ok", message: "API key removed.", credential: await aiCredentialStatus(scope) });
    }
    if (parsed.data.action === "set-model") {
      // Change the model on the existing key (no re-entry). Validate against the stored provider.
      const status = await aiCredentialStatus(scope);
      if (!status.configured || !status.provider) return jsonError("no_key", "Save an API key first.", 409);
      if (!isValidModel(status.provider, parsed.data.model)) return jsonError("invalid_model", "That model isn't available for this provider.", 400);
      await setAiCredentialModel(scope, parsed.data.model);
      return jsonOk({ code: "ok", message: "Model updated.", credential: await aiCredentialStatus(scope) });
    }
    // action === "set"
    if (!(await aiCredentialStatus(scope)).encryptionAvailable) {
      return jsonError("encryption_unavailable", "Key storage isn't configured yet — contact support.", 503);
    }
    if (!isValidModel(parsed.data.provider, parsed.data.model)) {
      return jsonError("invalid_model", "That model isn't available for this provider.", 400);
    }
    await saveAiCredential(scope, { provider: parsed.data.provider, apiKey: parsed.data.apiKey, model: parsed.data.model });
    return jsonOk({ code: "ok", message: "API key saved.", credential: await aiCredentialStatus(scope) });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("ai_credential_save_failed", "Could not save the API key.", 500);
  }
}
