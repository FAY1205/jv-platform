import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "@/lib/crypto/secret-box";

// ADR-0036: per-tenant BYO AI provider credential. Stored in the generic `settings`
// table under one key as { provider, enc } where `enc` is the AES-256-GCM ciphertext
// of the API key. The plaintext key is WRITE-ONLY — never returned to the client.

export const AI_CREDENTIAL_KEY = "ai_credential";

export const AI_PROVIDERS = ["google", "openai", "anthropic"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
};

export function isAiProvider(v: unknown): v is AiProviderId {
  return typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
}

interface StoredCredential {
  provider: AiProviderId;
  enc: string;
  /** Chosen model id (models-catalog). Optional for rows saved before model choice. */
  model?: string;
}

async function readCredentialRow(scope: ScopeContext): Promise<StoredCredential | null> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(tenantWhere(schema.settings, scope), eq(schema.settings.key, AI_CREDENTIAL_KEY)));
  const v = row?.value as Partial<StoredCredential> | undefined;
  if (!v || !isAiProvider(v.provider) || typeof v.enc !== "string") return null;
  return { provider: v.provider, enc: v.enc, model: typeof v.model === "string" ? v.model : undefined };
}

/** Client-safe status: whether a key is stored, for which provider + model — never the key. */
export async function aiCredentialStatus(scope: ScopeContext): Promise<{ configured: boolean; provider: AiProviderId | null; model: string | null; encryptionAvailable: boolean }> {
  const row = await readCredentialRow(scope);
  return { configured: row !== null, provider: row?.provider ?? null, model: row?.model ?? null, encryptionAvailable: isEncryptionConfigured() };
}

/** Store (encrypt) a provider + key + model. Throws if encryption isn't configured. */
export async function saveAiCredential(scope: ScopeContext, input: { provider: AiProviderId; apiKey: string; model: string }): Promise<void> {
  const value: StoredCredential = { provider: input.provider, enc: encryptSecret(input.apiKey), model: input.model };
  await getDb()
    .insert(schema.settings)
    .values({ tenantId: scope.tenantId, key: AI_CREDENTIAL_KEY, value })
    .onConflictDoUpdate({ target: [schema.settings.tenantId, schema.settings.key], set: { value, updatedAt: new Date() } });
}

/** Change ONLY the model on an existing credential (no re-entering the key). No-op if unset. */
export async function setAiCredentialModel(scope: ScopeContext, model: string): Promise<boolean> {
  const row = await readCredentialRow(scope);
  if (!row) return false;
  const value: StoredCredential = { ...row, model };
  await getDb()
    .update(schema.settings)
    .set({ value, updatedAt: new Date() })
    .where(and(tenantWhere(schema.settings, scope), eq(schema.settings.key, AI_CREDENTIAL_KEY)));
  return true;
}

/** Remove the stored credential. */
export async function clearAiCredential(scope: ScopeContext): Promise<void> {
  await getDb()
    .delete(schema.settings)
    .where(and(tenantWhere(schema.settings, scope), eq(schema.settings.key, AI_CREDENTIAL_KEY)));
}

/** Server-only: the decrypted credential for making a model call, or null. */
export async function loadAiCredential(scope: ScopeContext): Promise<{ provider: AiProviderId; apiKey: string; model?: string } | null> {
  const row = await readCredentialRow(scope);
  if (!row) return null;
  return { provider: row.provider, apiKey: decryptSecret(row.enc), model: row.model };
}
