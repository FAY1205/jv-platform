// ADR-0036: per-provider model catalog for the BYO assistant. PURE DATA (no imports)
// so both the server and the client settings UI can import it. Each provider lists the
// models offered, HIGHEST tier first; the default is that first entry. Per the owner's
// rule the list runs from the chosen max tier DOWN to its cheaper siblings (never above):
//   Google:    Gemini 3.6 Flash → 3.5 Flash-Lite   (2.0 was shut down 2026-06-01)
//   OpenAI:    GPT-5.6 Terra → Luna                 (Sol/flagship intentionally omitted)
//   Anthropic: Claude Sonnet 5 → Haiku 4.5
// All support tool calling + streaming (the assistant's requirement). Researched 2026-08.

export const AI_MODELS = {
  google: [
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
  ],
  openai: [
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  ],
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
} as const;

export type CatalogProvider = keyof typeof AI_MODELS;

/** The default model for a provider = its highest listed tier. */
export const DEFAULT_MODEL: Record<CatalogProvider, string> = {
  google: AI_MODELS.google[0].id,
  openai: AI_MODELS.openai[0].id,
  anthropic: AI_MODELS.anthropic[0].id,
};

export function isValidModel(provider: CatalogProvider, model: string): boolean {
  return AI_MODELS[provider].some((m) => m.id === model);
}

/** A model id the tenant chose, coerced to a valid one for the provider (default if not). */
export function coerceModel(provider: CatalogProvider, model: string | null | undefined): string {
  return model && isValidModel(provider, model) ? model : DEFAULT_MODEL[provider];
}

export function modelLabel(model: string): string {
  for (const list of Object.values(AI_MODELS)) {
    const hit = list.find((m) => m.id === model);
    if (hit) return hit.label;
  }
  return model;
}
