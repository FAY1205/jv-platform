# ADR-0036: Bring-your-own AI provider credentials (multi-provider)

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase / WP:** Post-go-live (owner request #25)

## Context

Until now the in-app assistant ran on ONE platform-held key: either the Vercel AI
Gateway (`AI_GATEWAY_API_KEY`) or a dev-only Google key, selected by `AI_PROVIDER`
(ADR-0027). Every tenant shared it, and the model was a fixed constant with no
selection UI.

The owner wants each workspace to supply its OWN AI credentials — "if the assistant
is enabled, the user inputs their own API key (provider, key, secret)" — so each
tenant pays their own provider directly and the platform holds no shared inference
cost. The owner chose a **multi-provider** model (Google, OpenAI, Anthropic), not a
single provider.

Two capabilities the codebase lacked:
1. **More than one provider SDK.** Only `@ai-sdk/google` was installed; the gateway
   path used a bare model string. OpenAI and Anthropic need their own AI-SDK
   provider packages.
2. **Encryption at rest.** A provider API key is a recoverable secret (it must be
   decrypted to call the provider), but the repo only ever *hashed* secrets
   one-way (OTP/tokens) — there was no symmetric-encryption helper and no master
   key.

## Decision

- **Add two dependencies:** `@ai-sdk/openai` and `@ai-sdk/anthropic` (this ADR is
  the "new dependency" gate CLAUDE.md requires). They are peers of the already-present
  `@ai-sdk/google`, share the `ai` v6 `LanguageModel` interface, and are constructed
  with an explicit `apiKey` (`createOpenAI({apiKey})`, `createAnthropic({apiKey})`,
  `createGoogleGenerativeAI({apiKey})`) — so the per-tenant key is injected, never read
  from `process.env`.

- **Per-tenant credential, encrypted at rest.** A new `AES-256-GCM` envelope helper
  (`src/lib/crypto/secret-box.ts`) encrypts the key under a new master key env var
  `AI_KEY_ENCRYPTION_KEY` (32 bytes, base64). The ciphertext blob + provider id live
  in the generic `settings` table (`ai_credential` key), reusing the existing
  per-tenant settings vehicle. The plaintext key is **write-only**: the API never
  returns it — only `{ configured: boolean, provider }`.

- **The credential is the gate.** `assistantGate`'s "has provider key" check becomes
  per-tenant (does THIS workspace have a stored credential?). Because a tenant brings
  its own paid provider account, the old production `AI_TIER=paid` block (which existed
  to keep real data off a free tier) no longer applies to the BYO path — the tenant
  accepts their provider's terms by supplying the key. The enabled toggle remains as the
  in-app guardrail, and usage metering stays (token counts; per-provider default-model
  pricing) — surfaced as a read-only "estimated usage this month".

  **Amendment (2026-08-02, owner follow-up):** the monthly spend CAP was removed. With
  BYO keys the in-app dollar figure is a list-price *estimate*, not the tenant's real
  provider invoice, so a hard in-app ceiling on it was misleading. Tenants cap spend in
  their own provider dashboard instead. Removed: `budgetDecision`/`DEFAULT_MONTHLY_CAP_USD`
  (budget.ts), the `ai_monthly_cap_usd` setting + `coerceCapUsd` (settings.ts), the
  `ai_budget_reached` gate branch, and the allowance input. Kept: the rate limit
  (abuse guardrail), usage metering, and the read-only usage estimate. The client
  `ai_budget_reached` band stays as harmless defensive code (server no longer emits it).

- **LGL-04 note:** with the gateway we relied on zero-retention. With BYO keys, data
  goes to the tenant's own provider account under the tenant's agreement with that
  provider. The Settings copy states this so the choice is informed.

## Consequences

- The owner must set `AI_KEY_ENCRYPTION_KEY` in each environment for the feature to
  work; without it, the credential inputs are disabled with a clear message and the
  assistant stays "not configured".
- The shared gateway/`AI_PROVIDER` env path stays in the code for now but is no longer
  the assistant's primary route; a later cleanup can remove it once every tenant is on
  BYO.
- Rotating `AI_KEY_ENCRYPTION_KEY` invalidates every stored credential (they can't be
  decrypted) — tenants would re-enter their keys. Documented; not automated.
