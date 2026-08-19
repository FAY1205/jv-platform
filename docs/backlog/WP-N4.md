# WP-N4: Search v2 — partial words, ranked, phone-proof (Ctrl-K + leads + portal)

Spec: SRCH-01..05 (§6.24) + new SRCH-06/07/08 minted here · **Tier A** (prod migration:
pg_trgm extension + trgm indexes — owner GREENLIT 2026-08-19: "migrate when you have
reviewed, tested and confident") · One PR + ADR-0051 + migration 0056.

Verified against main dc14a173 (2026-08-19) by the orchestrator: global search
(modules/search) is escaped-ILIKE substring, ordered by createdAt desc, admin-only
(SearchScopeError documents WHY — partner scope would see competitor partners, and
statusExpr lacks the R-22 ownStatusAuthorScope leg). The admin leads list `qTextMatch`
(modules/leads/queries.ts:48-56) and the portal list textMatch
(modules/portal/queries.ts:170-180) both use RAW `%${q}%` (unescaped — a typed `%`
matches every row) and lack phone matching. SRCH-03 pinned v1 to "no new extension
(boring ILIKE)" — this WP supersedes that HALF of SRCH-03 via ADR-0051.

## Goal
One shared search-match builder powering all three surfaces, with: multi-word queries
(AND of terms), phone-fragment matching everywhere, escaped patterns everywhere, and
relevance-ranked Ctrl-K results — backed by pg_trgm for ranking + future-proof index
acceleration. Matching semantics stay EXACT substring (no fuzzy/typo tolerance — that
is a deliberate deferred owner option the trgm indexes make one line later).

## New requirement IDs
- **SRCH-06 (multi-term):** the query is whitespace-tokenized into at most
  SEARCH_MAX_TERMS (6) terms — the bound applies to the SPLIT (DM-12); EVERY term must
  match (AND), each term may match ANY searched column (OR). Single-term behavior is
  unchanged. Applies to: global search (both groups), admin leads list `q`, portal
  leads list `q`. "john phoenix" now finds John's Phoenix lead.
- **SRCH-07 (phone-proof + literal patterns everywhere):** each surface ALSO matches
  the query's digits (≥ SEARCH_PHONE_MIN_DIGITS, per WHOLE query — reuse
  searchPhoneDigits) against `leads.phone_norm`; and every surface's patterns go
  through the ONE escapeLike (fixes the unescaped leads-list/portal patterns).
  Phone matching applies per-query as an extra OR-alternative that satisfies ONE term
  slot (design note below).
- **SRCH-08 (ranked Ctrl-K):** the global-search leads group orders by relevance:
  exact-identifier hits (refId / zip / phone digits) rank above fuzzy-text hits;
  text hits order by trigram similarity of the query against seller name / address /
  city (word_similarity); ties fall back to createdAt desc. Partners group: similarity
  on name, then name asc. Rank computed server-side in SQL (PRN-15); the overlay keeps
  server order. The leads LIST and portal LIST keep their existing explicit sort
  columns — ranking is a Ctrl-K concern only.

## Definition of done
- [ ] **ADR-0051**: adopt pg_trgm (supersedes SRCH-03's no-extension clause for
  ranking + index acceleration; matching stays exact-substring; fuzzy matching listed
  as the deliberate non-goal + future one-liner). Update the SRCH-03 row in
  docs/SPEC.md §6.24 in the same PR + add SRCH-06/07/08 rows (C-20 convention —
  the slice ships complete, backfill included).
- [ ] **Migration 0056** (`0056_search_trgm.sql`): `create extension if not exists
  pg_trgm` + GIN `gin_trgm_ops` indexes on leads.seller_first, leads.seller_last,
  leads.address, leads.city + partners.name. Short/identifier columns (zip, ref_id,
  phone_norm) deliberately stay unindexed — comment them (seq scan is fine at current
  scale; revisit at the N12 ~80k trigger). Plain CREATE INDEX (not CONCURRENTLY) with
  the 0051/0052 small-table rationale comment (prod leads ≈ 300 rows; placed
  proactively). ⚠️ journal `when` MUST exceed 1787094574008 (0055) — the drizzle
  timestamp trap; bump after generate. Follow 0055's precedent for snapshot handling.
  ⚠️ **Schema-placement trap:** Supabase installs extensions into the `extensions`
  schema; CI's vanilla postgres:16 installs to public. `gin_trgm_ops` +
  `word_similarity()` resolution depends on search_path in BOTH environments — verify
  empirically on the test DB (uoszwgbtpsqzytchvjve) AND in CI; schema-qualify
  explicitly if either fails. The migration must run green in both.
- [ ] **Shared builder** `src/modules/search/match.ts` (server-side; the pure token
  helpers stay/extend in ./schema.ts): `leadSearchMatch(q): SQL | undefined` and
  `partnerSearchMatch(q)` implementing SRCH-06/07 — consumed by all three surfaces
  (global search, leads `qTextMatch` replaced, portal textMatch replaced). Builders
  are narrowing conjuncts composed INTO the existing scoped predicates — they never
  touch scope themselves (PRN-08 unchanged; portal stays "can only narrow").
  Phone-term design: the digit alternative is derived from the WHOLE query; a query
  that is one phone fragment ("602-555") must still match; a mixed query
  ("smith 6025550") requires the text terms AND the digits to hit. State the exact
  rule in the builder docblock + pin with tests.
- [ ] **Ranking** in modules/search/queries.ts per SRCH-08: rank expression in the
  SELECT, ORDER BY rank desc, createdAt desc. Keep the true `total` count exact.
  Pin ordering invariants with integration tests (exact refId beats fuzzy name;
  better similarity beats worse; ties recency). No UI change to the overlay beyond
  received order (verify GlobalSearch renders server order — it does today).
- [ ] Portal placeholder copy gains "phone" ("Search seller, address, ZIP, phone,
  lead ID…") in both portal search inputs (mobile + desktop) and the admin leads
  filter placeholder if it enumerates fields — check.
- [ ] SEARCH_MAX_TERMS exported constant + tokenize() pure helper in
  modules/search/schema.ts with unit tests (bounds, collapse of runs of whitespace,
  escaping composition).

## Explicit non-goals (do NOT build)
Fuzzy/typo-tolerant MATCHING (deferred owner option) · portal Ctrl-K overlay
(SearchScopeError's two preconditions still unmet — do not relax) · tsvector/websearch
FTS · overlay UI redesign · notes/tasks search · N12 scale items (smart counts etc.).

## Tests (names carry IDs)
- Unit: tokenizer bounds/escaping (SRCH-06), digit extraction reuse (SRCH-07),
  builder SQL shape (no unescaped user text; parameters bound).
- Integration (test DB, ?sslmode=require): SRCH-06 multi-word match on leads +
  partners + portal; SRCH-07 phone fragment on all three surfaces + literal `%`/`_`
  matched literally on the leads LIST (new — was broken); SRCH-08 ordering invariants;
  cross-tenant + portal-narrowing-only probes (extend the existing search/leads/portal
  isolation suites — assert non-empty before absence, TST-11).
- **Full integration suite** before merge (shared query modules touched — §10 stage 7,
  the 975cfa6 lesson). Windows: vitest --maxWorkers=4.

## Ship gate (Tier A — owner pre-greenlit WITH conditions)
pr-reviewer + audit-tenancy (new query surface on three scoped paths) + audit-data
(migration/indexes/extension) all clean → full suite + CI green → merge (migrate-on-
merge applies 0056 to prod) → **prod verification**: extension present, 5 indexes via
pg_indexes, drizzle ledger 57/57 — recorded in the tracker before the WP is called done.
