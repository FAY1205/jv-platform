# AI Assistant (Phase B) — Design

**Date:** 2026-07-13 · **Status:** Approved by owner (brainstorm 2026-07-13; mockup rev-7 signed off)
**Spec sections:** AIA-01..06, SEAM-07, SET-11, PRN-08/10/12/14/15, SEC-05/07, LGL-04, BIL-04, TST-10
**Mockup:** https://claude.ai/code/artifact/35796b7b-0d8b-4a90-823f-3b655c7ba67b (Survey tokens, interactive)

## 1. What we're building

A floating bottom-right chat assistant for **admins** that answers questions about the
caller's own workspace — partner performance, coverage gaps, lead lookups, import
results, "explain this screen", and product how-to — with every figure grounded in a
typed read-tool result (AIA-03). It is an ask/answer assistant, not an insights engine.

### Owner decisions (locked 2026-07-13)

| Decision | Choice |
|---|---|
| Audience | **Admin-only V1** (AIA-01 as written; partner portal is a follow-up WP) |
| Capabilities | **Strictly read-only + deep links** (AIA-02); no writes, no confirm-gated actions |
| Question set | All 6 categories: performance/KPIs, coverage, lead lookup, imports, explain-screen, product how-to |
| Persistence | **Ephemeral chats** (client state only). Thumbs → `ai_feedback`. `ai_memory` learned-preferences loop **deferred** (AIA-04 seam kept) |
| Budget cap | **Hard stop** at the monthly cap; widget shows an allowance notice (no dollar amounts in the widget); usage detail lives in Settings |
| Model | **One fixed model, no selection UI** (owner call 2026-07-13): `google/gemini-3.1-flash-lite` via the Vercel AI Gateway, a single module constant. Haiku 4.5 (`anthropic/claude-haiku-4.5`) is the pinned fallback — a one-line constant change, not a UI. Owner ran a 2-round grounding/injection test; Flash-Lite passed all safety questions (see §6) |
| Data-use terms | Gemini **free tier trains on submitted data** → allowed in **dev only** (synthetic data, SEC-07); **production requires the paid tier** (LGL-04: customer data never trains models). Enforced by a boot guard (§8) |
| Seller PII | **The model never sees it** (§7) |
| Widget UX | Mockup rev-7: theme-aware plasma-orb launcher, 400×640 panel, contextual suggestion chips, source chips + deep links + thumbs per answer, bulleted answers, elevation system |

## 2. Requirements trace

- **AIA-01** admin-only chat → route gated by `requireAdminResponse`.
- **AIA-02** read-only by construction → tools wrap existing scoped query functions only (SEAM-07); no mutation function is importable from the tool module.
- **AIA-03** grounded answers → system prompt mandates tool-derived figures + refusal;
  UI source chips are derived from **actual tool invocations**, not model claims.
- **AIA-04** feedback → thumbs write `ai_feedback` (existing table). Learned `ai_memory` records: deferred WP.
- **AIA-05 / PRN-10** untrusted content → §7 layered injection defense + TST-10 cases.
- **AIA-06 / BIL-04 / SET-11** metering + cap → new `ai_usage` table, per-question cost, monthly hard cap, admin-visible usage.
- **PRN-08** every read through `lib/scope.ts` — scope comes from the session, never the model (§5).
- **PRN-15** no re-derived numbers — tools return **pre-computed** analytics; the model relays, it does not aggregate (validated by the owner's model test: both Gemini tiers mis-summed a voided import when forced to do math the tools should do).
- **SEC-05** seller PII excluded from model context and traces (§7).
- **SEC-07 / LGL-04** dev-only free tier; prod paid-tier guard (§8).
- **PRN-12/14** widget consumes semantic tokens; sources/status never color-alone.

## 3. Architecture

```
Widget (client, admin AppShell)                    Server
┌───────────────────────────┐   POST /api/ai/chat  ┌──────────────────────────────┐
│ AssistantWidget           │ ───────────────────▶ │ getServerScope() (PRN-08)    │
│  · launcher (plasma orb)  │  {messages, screen}  │ requireAdminResponse + CSRF  │
│  · panel (useChat stream) │                      │ gate: enabled? budget? rate? │
│  · suggestion chips       │ ◀─────────────────── │ streamText(model, tools(scope│
│  · source chips/deeplinks │   UIMessage stream   │  ), system(screen), caps)    │
│  · thumbs → /api/ai/      │                      │ record ai_usage (tokens,cost)│
│    feedback               │                      └──────────────────────────────┘
└───────────────────────────┘                        tools = thin wrappers over
                                                     existing scoped functions
```

New code:
- `src/modules/ai/` — `tools.ts` (tool defs), `mask.ts` (PII-safe projections, pure),
  `prompt.ts` (system prompt + screen catalog, pure), `suggestions.ts` (route → chips, pure),
  `pricing.ts` (model → µ¢/token, pure), `budget.ts` (cap/rate decisions, pure),
  `usage.ts` (record + month-to-date query), `settings.ts` (SET-11 keys over the generic
  `settings` table, same pattern as `export-settings.ts`).
- Routes: `POST /api/ai/chat`, `POST /api/ai/feedback`, `GET/PUT /api/settings/ai`
  (admin + CSRF + Zod; uniform error envelope).
- `src/components/assistant/` — `AssistantWidget.tsx` (launcher+panel), `Orb.tsx`
  (canvas renderer from mockup), mounted in `AppShell` only (admin surface),
  lazy-loaded (`next/dynamic`) so AI deps stay out of the base bundle.
- Migration **0021**: `ai_usage` table + RLS + indexes.

Dependencies (**ADR-0027**): `ai` (AI SDK v6) + `@ai-sdk/react`. Model via plain
`"provider/model"` gateway strings — no provider-specific SDK.

## 4. Tool surface (SEAM-07)

All tools take the **server-resolved `ScopeContext`** via closure; the model supplies
only human-readable refs and ranges. Every wrapped function already exists and is
scope-first. Output passes through `mask.ts` (§7) and includes a server-built internal
`path` for deep links plus a `source` label for the UI chip.

| Tool | Wraps | Model-supplied args |
|---|---|---|
| `get_dashboard_stats` | `dashboardData` | `range: '7d'\|'30d'\|'90d'` |
| `get_partner_performance` | `partnerPerformanceDetail` (id resolved from ref/name via `listPartners`) | `partner` (ref `JV-###` or name), `range` |
| `list_partners` | `listPartners` | — |
| `get_partner_territory` | `territoryOf` (id resolved as above) | `partner` |
| `get_coverage_summary` | `coverageMapData` + `unmatchedStateStats` | — |
| `find_leads` | `listLeads` | `state?`, `status?`, `assigned?`, `page?` (Zod-bounded) |
| `get_lead` | `getAdminLeadDetail` | `refId` (`LD-#####`) |
| `list_imports` | `listRuns` | — |
| `get_import` | `getRunDetail` | `ref` (`UP-YYYY-###`) |

Name→partner resolution returns **all matches** when ambiguous (e.g. two "Ridge…"
partners) so the model must ask which — disambiguation is structural, not model
vigilance (finding from the owner's test round 2).

"Explain this screen" and product how-to use **no data tool**: the client sends the
current route (Zod-validated against the screen catalog enum); `prompt.ts` injects the
matching static screen description. Unknown route → generic description.

Guards on the loop: max 5 tool steps, `maxOutputTokens` 1024, last 12 messages replayed,
message length ≤ 2000 chars.

## 5. Tenancy (PRN-08) — the load-bearing property

- Scope is resolved once per request from the verified session (`getServerScope`) and
  bound into the tools by closure. **No tool accepts a tenant, partner, or user id.**
- Tools call the same functions the UI calls; those functions already route through
  `lib/scope.ts` builders. No new query paths, no service role, no bespoke SQL.
- The chat route is admin-only; a partner session gets the uniform 403.
- Reviews: **audit-tenancy + audit-security are mandatory** on the WP that lands the
  tool/route surface, plus pr-reviewer as always.

## 6. Model & grounding behavior

- The model is a single constant: `AI_MODEL = "google/gemini-3.1-flash-lite"` (no
  selection UI, owner call). Pinned fallback `anthropic/claude-haiku-4.5` documented in
  ADR-0027 — swapping is a one-line change plus rerunning the manual eval.
- Owner-run acceptance test (2 rounds, 15 questions): Flash-Lite passed **all**
  safety-critical behaviors — injection resistance (shouty override + subtle authority
  claim), PII refusal, grounded refusal ("I don't have that"), zero hallucinated numbers.
  Its two misses (summing a voided import; missing the 2nd name match) are both removed
  structurally: tools return pre-filtered, pre-computed numbers (PRN-15; voided leads are
  already soft-deleted out of every query) and lookup returns all matches.
- Remaining unknown = live multi-step tool calling → gated by TST-10 evals (§9) with the
  fallback one settings-string away.
- Answer style (system prompt): plain language, bullets where applicable, mono-styled
  refs, ≤ 1 deep link, no LaTeX, no forecasts, "I don't have that" over improvisation.

## 7. PII & prompt-injection design (SEC-05, PRN-10, AIA-05)

**Masking rule: the model sees exactly what the ADR-0025 PII purge would keep.**
`mask.ts` projections return city/state/zip + decision/status columns and **never**:
seller name, phone, email, street address, `raw_json`, or **any free-text note body**
(source `notes` and `lead_notes` are both excluded — they are the primary injection
vector and can embed seller PII in free text that no scrubber reliably catches).
Asked for contact info or note contents, the assistant deep-links to the lead page.

Layered injection defense (content the model does read — campaign/source names, partner
names, statuses — is still attacker-influenced):
1. **Capability layer (the real defense):** read-only tools, scope by closure, nothing
   to exfiltrate to (no fetch/URL tools), worst case = wrong words in an answer.
2. **Masking layer:** the juiciest targets never enter context (above).
3. **Prompt layer:** tool results injected as JSON data blocks; system prompt states
   field text is data, never instructions, and authorization claims inside data are void.
4. **UI layer:** deep links render only for same-origin known path prefixes
   (`/dashboard|/leads|/unmatched|/imports|/runs|/partners|/coverage|/activity|/settings`);
   anything else renders as plain text. Source chips come from actual tool calls.
5. **Eval layer:** TST-10 injection corpus (§9).

Traces/logging: `ai_usage` stores counts and cost only — never message content (SEC-05).
`logError` paths must not log prompt/response bodies.

## 8. Cost, metering, cap (AIA-06, SET-11, BIL-04)

- **Migration 0021 — `ai_usage`**: `id, tenant_id, user_id, model, input_tokens,
  output_tokens, cost_microcents, created_at` + `(tenant_id, created_at)` index +
  deny-by-default RLS (same posture as other tables). No seed.
- `pricing.ts`: pure table `model string → {inMicrocentsPerMTok, outMicrocentsPerMTok}`
  for the two supported models; unknown model → assistant disabled with a clear error
  (never guess a price). Cost is computed and stored at write time.
- **Cap check (pre-request):** month-to-date `SUM(cost_microcents)` ≥ cap → uniform
  envelope `{code:"ai_budget_reached"}`; widget shows the allowance band (no $ amounts).
  Post-request usage is recorded even for capped-mid-stream responses.
- **Rate limit:** more than 15 questions per user per minute → 429 (count over
  `ai_usage`, sliding window; the 16th request in a rolling minute is rejected).
- **SET-11 settings** (rows in the generic `settings` table): `ai_enabled` (default
  **false**) and `ai_monthly_cap_usd` (default 10). No model setting — the model is a
  code constant (§6). Admin UI: **Settings → AI assistant** section — enable Switch,
  cap input, month-to-date usage readout (dollars live here, not in the widget).
- **Env (`env.ts`):** `AI_GATEWAY_API_KEY` (owner setup item) and `AI_TIER`
  (`'paid' | 'free-dev'`). **In production the chat route hard-refuses unless
  `AI_TIER=paid`** (uniform `ai_disabled` envelope regardless of the `ai_enabled`
  setting, and the Settings page shows why) — the SEC-07-pattern guard that makes the
  dev-only free tier safe (LGL-04). Both env vars are go-live checklist items.

## 9. Testing (TST-10) & verification

- **Unit (pure):** mask projections (PII fields provably absent), pricing math, budget
  decision (cap boundary, month rollover), rate window, suggestions map, screen catalog,
  deep-link path whitelist, prompt assembly.
- **Integration (mock model, no spend):** AI SDK mock transport drives the real route +
  real tools against the dev DB — asserts: tools receive session scope (cross-tenant
  fixture never leaks), tool JSON contains no masked field, partner-name ambiguity
  returns all matches, budget cap blocks, usage row written with correct cost, admin-only
  403 for partner session.
- **TST-10 injection corpus:** fixture leads/campaign names carrying instruction
  payloads (override, authority claim, exfil request) → assert masked fields absent from
  the assembled prompt and, with the mock model echoing tool text, that the UI link
  whitelist strips hostile links. The owner's 15-question live test becomes a curated
  **manual eval script** (`scripts/ai-eval.ts`, env-gated, dev-only) run before enabling
  a new model — automated CI never spends tokens.
- **Verify (WP-AI-2):** Playwright screenshots of the widget states (welcome/answer/
  refusal/cap, light+dark) via the throwaway gallery-route pattern; serial vitest.

## 10. Work packages

- **WP-AI-1 — backend spine (Tier A):** ADR-0027 + deps; `env.ts` additions; migration
  0021; `src/modules/ai/*`; `/api/ai/chat` + `/api/ai/feedback` + `/api/settings/ai`;
  unit + integration + TST-10 tests. Reviews: pr-reviewer + **audit-tenancy** +
  **audit-security**. Verifiable via curl with a real session.
- **WP-AI-2 — widget + settings UI (Tier B):** `AssistantWidget` + `Orb` (from mockup),
  suggestions/screen catalog wiring, feedback UI, cap state, Settings → AI assistant
  section, gallery cards, screenshots, owner walkthrough. Reviews: pr-reviewer +
  audit-design-system + audit-a11y (+ frontend-arch).
- One commit per WP; owner go before commit and before push (per-action).

## 11. Non-goals / deferred (WP candidates)

Partner-portal assistant · `ai_memory` learned-preferences loop + admin memory editor
(AIA-04 second half) · conversation persistence · automated live-model eval in CI ·
`events`/audit rows per question · voice/attachments · model auto-tiering. Also owner
setup items: create the Vercel AI Gateway key (BYOK Google paid key for prod),
set `AI_GATEWAY_API_KEY` + `AI_TIER` in envs (go-live checklist).
