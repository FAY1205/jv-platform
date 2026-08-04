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
  // ADR-0036: BYO per-tenant models (models-catalog.ts). The tenant pays their own
  // provider, and the in-app usage $ was removed — so this only feeds the stored
  // ai_usage.cost column (not shown anywhere). An unpriced model returns null → 0 cost
  // recorded, which is fine. Priced where a public rate is known (2026-08):
  "gemini-3.6-flash": { inputMicroUsdPerMTok: 1_500_000, outputMicroUsdPerMTok: 7_500_000 },
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
