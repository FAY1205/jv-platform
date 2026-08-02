import { generateText } from "ai";
import type { ScopeContext } from "@/lib/scope";
import { loadAiCredential, AI_PROVIDER_LABELS } from "./credential";
import { resolveTenantModel, tenantModelId } from "./model";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { logError } from "@/lib/observability";

// ADR-0036: on-demand "test connection" for a tenant's stored BYO provider key. Makes
// ONE tiny real call to the provider and reports a precise, safe reason on failure —
// so an admin can tell an invalid key from a decrypt problem from a model/quota issue
// without reading server logs. Never returns the key (SEC-05); provider error text
// carries a status/message, never the secret.

export type CredentialTestResult =
  | { ok: true; provider: string; model: string }
  | { ok: false; reason: "not_configured" | "no_key" | "decrypt" | "provider"; message: string };

/** Turn a raw provider/SDK error into a short, actionable, key-free hint. */
function providerHint(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (/api key|unauthor|invalid.*key|forbidden|permission|401|403/.test(msg)) {
    return "The provider rejected the key. Check you pasted the correct key for the selected provider (an OpenAI key won't work under Google, etc.).";
  }
  if (/\bmodel\b|not found|does not exist|404/.test(msg)) return "The default model isn't available for this key or account.";
  if (/quota|rate limit|429|exceed|billing|payment|insufficient/.test(msg)) return "The provider reports a quota, billing, or rate-limit problem on this key.";
  if (/timed out|timeout|aborted|network|fetch failed|enotfound/.test(msg)) return "The provider didn't respond in time. Try again in a moment.";
  const raw = e instanceof Error ? e.message : String(e);
  return "The provider call failed: " + raw.slice(0, 180);
}

export async function testAiCredential(scope: ScopeContext): Promise<CredentialTestResult> {
  if (!isEncryptionConfigured()) {
    return { ok: false, reason: "not_configured", message: "Secure key storage isn't configured on this deployment (AI_KEY_ENCRYPTION_KEY)." };
  }
  let cred: Awaited<ReturnType<typeof loadAiCredential>>;
  try {
    cred = await loadAiCredential(scope);
  } catch {
    // decryptSecret throws when the master key changed since the key was saved, or the
    // blob is malformed — the stored ciphertext can no longer be read.
    return { ok: false, reason: "decrypt", message: "The saved key couldn't be read — the encryption key may have changed. Remove it and paste the key again." };
  }
  if (!cred) return { ok: false, reason: "no_key", message: "No API key is saved yet." };

  try {
    await generateText({
      model: resolveTenantModel(cred),
      prompt: "ping",
      maxOutputTokens: 4,
      abortSignal: AbortSignal.timeout(12_000),
    });
    return { ok: true, provider: AI_PROVIDER_LABELS[cred.provider], model: tenantModelId(cred) };
  } catch (e) {
    logError("ai_credential_test_failed", { provider: cred.provider, detail: e instanceof Error ? e.message : "unknown" });
    return { ok: false, reason: "provider", message: providerHint(e) };
  }
}
