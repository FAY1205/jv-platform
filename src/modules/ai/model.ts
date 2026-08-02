import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { env } from "@/lib/env";
import { AI_MODEL } from "./pricing";
import type { AiProviderId } from "./credential";

// Runtime model-provider selection (ADR-0027 amendment).
//
// Default ("gateway"): the bare `AI_MODEL` string routes through the Vercel AI
// Gateway — zero data retention, so LGL-04 ("customer data never trains a model")
// holds without further work; one `AI_GATEWAY_API_KEY` (vck_…) authenticates it.
//
// "google": call Google's Generative Language API directly with a Google AI
// Studio key (GOOGLE_GENERATIVE_AI_API_KEY, AIza…). This is a DEV-ONLY path for
// vetting the model on Google's free tier against synthetic data (SEC-07) — the
// free tier trains on submitted content, so it must never see real partner data.
// Production is independently blocked from any free tier by the AI_TIER=paid gate
// in `assistantGate`, regardless of which provider is selected.
//
// The direct Generative Language API exposes the Flash-Lite model under the
// preview id (no "google/" prefix); the gateway used the un-suffixed id. Pricing
// + metering stay keyed on `AI_MODEL` (same model, same Flash-Lite rates).
export const GOOGLE_MODEL_ID = "gemini-3.1-flash-lite-preview";

/** The `LanguageModel` to run, per the configured PLATFORM provider (legacy path). */
export function resolveModel(): LanguageModel {
  return env.AI_PROVIDER === "google" ? google(GOOGLE_MODEL_ID) : AI_MODEL;
}

/** Whether the active PLATFORM provider's credential is configured (legacy gate). */
export function hasProviderKey(): boolean {
  return env.AI_PROVIDER === "google"
    ? Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY)
    : Boolean(env.AI_GATEWAY_API_KEY);
}

// ADR-0036: BYO per-tenant model. Each provider's cost-effective default model; the
// tenant's own key determines access. Pricing/metering in pricing.ts keys on these ids.
export const PROVIDER_MODELS: Record<AiProviderId, string> = {
  google: "gemini-2.0-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
};

/** Build a `LanguageModel` from a tenant's own credential (explicit apiKey, never env). */
export function resolveTenantModel(cred: { provider: AiProviderId; apiKey: string }): LanguageModel {
  const modelId = PROVIDER_MODELS[cred.provider];
  switch (cred.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: cred.apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey: cred.apiKey })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: cred.apiKey })(modelId);
  }
}
