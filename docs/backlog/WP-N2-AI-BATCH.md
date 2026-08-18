# WP-N2: AI batch (C-45a/b/c · prompt upgrades · settings copy)
Spec: AIA-01..05, AIS-01..09 (no regression), SEC-05, PRN-10/12/14 · Phase: post-B · Tier: **B**
(one new read tool → audit-tenancy included anyway; UI diff → audit-design-system).

Verified against code 2026-08-19: rate gate never auto-clears (AssistantWidget.tsx:55, only
newChat resets); chips are empty-state-only (:253); `listAdminActivity` exists scope-first with
an actor email join (modules/activity/queries.ts:46) → C-45b is FEASIBLE as a masked projection;
stale copy at src/app/(admin)/settings/ai/page.tsx:7.

## Definition of done

### C-45a — post-answer follow-up chips (AIS-10, mint)
- [ ] A bounded row (≤3) of follow-up chips below the LAST assistant message ONLY, when idle
      (`!busy && !blocked && !error`), reusing `SuggestionChips`. Source: `suggestionsFor(screen)`
      minus questions already asked this session (case-insensitive match on sent user texts);
      "Explain this screen" keeps last position when present. Never rendered mid-stream, never
      after a gate band, gone once the user types/sends.
- [ ] Chip click = `send(text)` (the existing path). No layout shift on stream end beyond the
      row appearing (respect scroll pinning: appearing chips must not yank a scrolled-up view).

### C-45b — masked audit-trail tool (AIS-11, mint)
- [ ] New tool `get_recent_activity` in modules/ai/tools.ts wrapping `listAdminActivity(scope,
      {page:1, pageSize:15, category?})` with an input `category: enum(all|security|data)`.
      Projection (mask.ts, allowlist per house convention): `{when, actor: maskActorEmail,
      action, entityType, ref, category}` — **DROP `before`/`after` entirely** (arbitrary jsonb,
      the free-text/PII carrier) and **`ref` only when entityRef matches a ref-shaped id**
      (`/^(LD|PR|IM|UP|SP)-/i`), else null (prompt rule 5 bans UUIDs).
      `maskActorEmail`: first char + "…" + @domain (SEC-05 per C-45 note). `source:
      "Activity"`, `path: "/activity"`.
- [ ] suggestions.ts: `activity` screen earns a native chip ("What changed recently?"),
      stale "No audit-trail chip until…" comment (:24-25) fixed. BANNED_KEYS leak test
      extended over the new projection.
- [ ] Partner scope: unreachable by construction (`buildAiTools` throws without `ai.use`;
      partners hold no capabilities) — assert in a test leg, not new branching.

### C-45c — rate-gate auto-clear (AIS-12, mint)
- [ ] `gate === "rate"` self-clears after ~60s (matches the 429 copy "give it a minute"):
      timer set on entering the state, cleared on unmount/newChat/manual clear; `no_key`/
      `disabled` never auto-clear (they are configuration states). Composer re-enables; the
      server re-gates the next turn if still limited.

### Prompt upgrades (extend prompt.ts; AIS-01..09 tests must stay green)
- [ ] New "Primitives that are commonly mixed up" block (static, cacheable): distributed vs
      leads-in; removed (MLS) vs unmatched (no coverage) vs voided (recalled import); ZIP
      override beats state rule; Hot = scoring band (38+/50) not lead status; partner STATUS
      (roster) vs lead status; held (5-min window) vs distributed.
- [ ] Data-efficiency rules block: answer from tool results ALREADY in the conversation when
      they cover the question (never re-call for the same range); one tool call when one
      suffices; pick the narrowest tool (named partner → get_partner_performance, not
      dashboard stats); at most one clarifying question then stop.
- [ ] Typed record references: formalize ONLY if it composes with the existing tool→path link
      rendering (rule 5 + auto nav-chip); otherwise leave rule 5 as-is and record the deferral
      in the summary. Default posture: defer.
- [ ] ai-prompt.test.ts extended for the new blocks; existing AIS legs unmodified.

### Settings copy (copy-only)
- [ ] settings/ai/page.tsx:7 description trimmed — drop "monthly allowance, and usage this
      month" (owner dropped the usage UI 2026-08-19); match what AiSettings actually renders
      (enable switch + provider key). E.g. "The in-app assistant and its provider connection."

## Out of scope
Per-tenant chip personalization (ai_memory); streaming per-tool progress labels; partner-scoped
assistant; usage UI revival; budget caps (ADR-0036 removed them).

## Tests
tests/unit/ai-suggestions / assistant widget legs: "AIS-10: follow-up row bounded, idle-only,
dedupes asked questions", "AIS-12: rate gate self-clears at 60s, no_key/disabled do not";
tests/unit/ai-mask / ai-tools legs: "AIS-11: activity projection drops before/after, masks
actor, nulls non-ref entityRef", BANNED_KEYS sweep over the new tool; ai-prompt.test.ts new
blocks; AIS-01..09 legs untouched and green.

## Self-check vs non-negotiables
SEC-05 (mask projection, no before/after) · PRN-10 (tool text stays data; no eval) · PRN-08
(tool wraps the existing scope-first query; scope by closure) · PRN-12/14 (chips reuse tokens;
gate states carry text) · PRN-15 (no client-side stat derivation).
