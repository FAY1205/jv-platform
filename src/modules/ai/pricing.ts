// AI assistant pricing (AIA-06, ADR-0027). PURE. Integer micro-dollars everywhere
// ($1 = 1_000_000 µ$) so budget math never floats. Only VETTED models are priced —
// an unknown model returns null and the caller refuses (never guess a price).

export const AI_MODEL = "google/gemini-3.1-flash-lite";

export interface ModelPrice {
  inputMicroUsdPerMTok: number;
  outputMicroUsdPerMTok: number;
}

const PRICES: Record<string, ModelPrice> = {
  // Gemini 3.1 Flash-Lite paid tier: $0.25 in / $1.50 out per 1M tokens (2026-07).
  "google/gemini-3.1-flash-lite": { inputMicroUsdPerMTok: 250_000, outputMicroUsdPerMTok: 1_500_000 },
  // Pinned fallback (ADR-0027): Claude Haiku 4.5, $1 in / $5 out per 1M tokens.
  "anthropic/claude-haiku-4.5": { inputMicroUsdPerMTok: 1_000_000, outputMicroUsdPerMTok: 5_000_000 },
  // ADR-0036: BYO per-tenant default models (PROVIDER_MODELS). Public list rates as
  // of 2026-08 — the tenant pays their own provider; these drive only the in-app
  // usage estimate. An unpriced model still returns null → cost shown as ~$0.
  "gemini-2.0-flash": { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 400_000 },
  "gpt-4o-mini": { inputMicroUsdPerMTok: 150_000, outputMicroUsdPerMTok: 600_000 },
  "claude-3-5-haiku-latest": { inputMicroUsdPerMTok: 800_000, outputMicroUsdPerMTok: 4_000_000 },
};

export function priceFor(model: string): ModelPrice | null {
  return PRICES[model] ?? null;
}

/** Cost of one exchange in µ$, rounded UP (never understate spend). Null = unpriced model. */
export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return Math.ceil((inputTokens * p.inputMicroUsdPerMTok + outputTokens * p.outputMicroUsdPerMTok) / 1_000_000);
}
