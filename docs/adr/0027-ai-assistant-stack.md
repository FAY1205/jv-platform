# ADR-0027: AI assistant stack — AI SDK v6 via Vercel AI Gateway, Gemini 3.1 Flash-Lite default

- **Status:** Proposed (accepted with WP-AI-1)
- **Date:** 2026-07-13
- **Phase / WP:** Phase B (AI Assistant) / WP-AI-1

## Context

Phase B adds the admin chat assistant (AIA-01..06, design:
`docs/superpowers/specs/2026-07-13-ai-assistant-design.md`). It is the repo's first
LLM integration; no AI dependencies exist. CLAUDE.md requires an ADR for any new
dependency. Three choices need recording: the client library, the provider path, and
the model — plus the data-use constraint that shapes them (LGL-04: customer data is
never used to train AI models; SEC-05: PII masked out of AI traffic).

## Decision

1. **Dependencies: `ai` (Vercel AI SDK v6) + `@ai-sdk/react`.** `streamText` with typed
   Zod tools server-side; `useChat` streaming client-side. No other AI packages —
   in particular **no provider SDKs** (`@ai-sdk/anthropic`, `@ai-sdk/google`, `@google/genai`).
2. **Provider path: the Vercel AI Gateway** with plain `"provider/model"` strings.
   One integration for every model family, zero token markup, per-user/tag usage
   attribution, and model switching as a string constant. Env is already Vercel/Next;
   auth via `AI_GATEWAY_API_KEY`.
3. **The model: `google/gemini-3.1-flash-lite` (paid tier), a single module constant —
   no model-selection UI** (owner call 2026-07-13, simplifying SET-11's "provider" knob
   away for V1). Owner-selected after a 2-round, 15-question grounding/injection test:
   all safety-critical behaviors passed (injection ×2 including an authority-claim
   variant, PII refusal, grounded refusal, no hallucinated figures). Cheapest
   spec-compliant option (~$0.25/$1.50 per MTok ≈ 0.2¢/question).
   **Pinned fallback: `anthropic/claude-haiku-4.5`** ($1/$5 per MTok) — a one-line
   constant change (plus its pricing row + rerunning the manual eval) if Flash-Lite
   fails the TST-10 live tool-calling eval.
4. **Tier guard (LGL-04/SEC-07):** Google's **free tier trains on submitted content**,
   so it is permitted **only against dev's synthetic data**. New env `AI_TIER`
   (`'paid' | 'free-dev'`); production refuses AI traffic unless `AI_TIER=paid`,
   mirroring the SEC-07 email-sink pattern. The public security page's "never used to
   train AI models" claim (LGL-04) therefore holds unconditionally in production.

## Alternatives considered

- **Direct Anthropic/Google SDKs.** Rejected: per-provider wiring, model switching
  becomes code, loses gateway failover/attribution; the platform guidance for this env
  is gateway strings by default.
- **Claude Haiku 4.5 as the default.** Strong tool-calling prior, but 4× the cost and
  the owner's own test showed Flash-Lite equivalent on every safety behavior for this
  tools-do-the-math design (PRN-15 keeps aggregation out of the model). Kept as the
  documented fallback.
- **Gemini 3.5 Flash / 2.5 family.** 3.5 Flash costs more than Haiku ($1.50/$9) and
  shared Flash-Lite's one arithmetic miss in testing; the 2.5 generation is cheaper but
  a generation old with near-term deprecation risk.
- **Gemini free tier in production.** Rejected outright — trains on customer data,
  breaking LGL-04 and the ToS/security-page commitments.

## Consequences

- Two new npm deps (`ai`, `@ai-sdk/react`); widget code is lazy-loaded so the base
  bundle is unaffected.
- New envs `AI_GATEWAY_API_KEY` + `AI_TIER` join the go-live checklist (owner setup:
  gateway key; BYOK paid Google key for prod, or Vercel-managed keys).
- `pricing.ts` must know each enabled model's rates; enabling a model outside the vetted
  two requires touching that table (deliberate friction — unknown price = disabled).
- Provider swap risk is contained to one constant + a pricing row + rerunning the
  manual eval script (`scripts/ai-eval.ts`).
