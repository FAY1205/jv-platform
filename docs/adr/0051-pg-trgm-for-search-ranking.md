# ADR-0051: Adopt pg_trgm for search ranking and index acceleration (supersedes SRCH-03's no-extension clause)

- **Status:** Accepted
- **Date:** 2026-08-19
- **Phase / WP:** Phase C · N-slices · WP-N4 (Search v2 — multi-term, ranked, phone-proof)
- **Relates to:** SPEC §6.24 SRCH-01..08 · ADR-0048 (SQL-only migrations, non-CONCURRENTLY index
  adds) · migration `0056_search_trgm` · PRN-15, PRN-08, DM-12, DM-13, SEC-05

## Context

SRCH-03 pinned v1 of global search to "**no new extension/dependency (boring ILIKE)**". That was
the right call for a jump-to overlay shipped in one slice: `ILIKE '%term%'` over six columns is
obvious, portable, and at ~300 leads per tenant it is instant.

Two things v1 deliberately did not do are now the WP-N4 requirements:

1. **Ordering.** The overlay returned matches in `created_at DESC` — the order the rows happened
   to be uploaded in. Typing a ref id put the exact lead wherever recency left it. There is no
   ordering signal in a boolean `ILIKE`: a match is a match.
2. **Indexability.** A leading-wildcard `LIKE '%x%'` cannot use a btree index — the three search
   surfaces are seq scans by construction. Harmless today; not a thing to discover at the N12
   ~80k-leads/tenant trigger, when adding an extension is a production change under pressure
   rather than a quiet one on a 300-row table.

Both wants are the same extension. `pg_trgm` is a **contrib** module shipped with PostgreSQL
itself (no vendoring, no supply chain, present on Supabase and on the vanilla `postgres:16` CI
image), and it provides exactly two things we need: `word_similarity()` for a relevance score, and
`gin_trgm_ops` so a leading-wildcard `LIKE` has an index that can serve it.

The alternative — ranking in TypeScript after fetching — is barred by PRN-15 (computed numbers come
from the database, not re-derived elsewhere) and is wrong anyway: you cannot rank a page you have
already truncated to 10 rows.

## Decision

**Adopt `pg_trgm` (migration 0056), superseding the "no new extension" HALF of SRCH-03.** The rest
of SRCH-03 — server-side, debounced — stands unchanged, and SRCH-03 is amended in §6.24 rather than
deleted.

Scope of the adoption, deliberately narrow:

- **Ranking only, and only for Ctrl-K (SRCH-08).** The global-search leads group orders by a rank
  expression computed in SQL: `+2` when the row matched an identifier (ref id / ZIP / phone digits)
  — an unambiguous "take me to THAT lead" — plus the best `word_similarity` of the query against
  the seller's full name, address and city. The `+2` tier constant is larger than any similarity
  can reach, so identifier hits are strictly above text hits rather than merely usually above.
  Partners rank by `word_similarity` on name, then name asc. The admin leads LIST and the portal
  LIST keep their existing explicit sort columns — neither imports the ranking, and neither
  depends on the extension.
- **Indexes** (`0056`): GIN `gin_trgm_ops` on `leads.seller_first`, `leads.seller_last`,
  `leads.address`, `leads.city`, `partners.name`. The short identifier columns (`zip`, `ref_id`,
  `phone_norm`) stay unindexed — trigrams on a 5-character ZIP are mostly overhead; they get their
  own treatment at the N12 trigger if they ever need one.
- **MATCHING semantics do not change.** Search stays **exact substring** (`ILIKE`, escaped,
  bound). No `similarity()` threshold in a `WHERE`, no `%` operator, no typo tolerance.

**Known limit, accepted:** `SEARCH_MIN_CHARS` is 2, which sits *below* trigram granularity —
pg_trgm indexes on 3-character grams, so a 2-character query cannot use these indexes and
seq-scans (EXPLAIN-verified). That is deliberate: the product wants `wh` to answer, and at
~300 leads per tenant a scan is instant. It is on the N12 ~80k list to either raise the floor
to 3 or give short queries a separate prefix-index path.

## Explicit non-goal: fuzzy matching

Trigram indexes make fuzzy matching roughly a one-line change (`where name % $1` or
`word_similarity(q, col) > 0.4`). **We are not making it**, and that is a product decision, not an
oversight: fuzzy matching means an admin searching a seller's surname gets rows that are *not* that
seller, silently. On a screen whose job is "take me to the right lead", a wrong-but-plausible hit
is worse than no hit. It is an **owner option**, not an engineering default — the infrastructure is
now in place for the day the owner asks for it.

## Extension schema placement (the trap this decision had to resolve)

`gin_trgm_ops` (DDL) and `word_similarity()` (every ranked query) are resolved through the
connection's `search_path`, so *where the extension is installed* decides whether the app's SQL
parses at all — and the two environments the same SQL must run in disagree:

| | `search_path` | `current_schema()` | has an `extensions` schema |
|---|---|---|---|
| Supabase (prod + `jv-platform-test`), role `postgres` | `"$user", public, extensions` | `public` | yes |
| CI (`postgres:16`, superuser) | `"$user", public` | `public` | **no** |

**Decision: plain unqualified `CREATE EXTENSION IF NOT EXISTS pg_trgm`,** which installs into the
current schema — `public` in **both** environments. One placement, on the `search_path` everywhere,
so the identical SQL that CI proves is the SQL prod runs.

Rejected: `WITH SCHEMA extensions` (the Supabase house style) — it **cannot run on CI at all**
(no such schema), so it would leave the production query path unverified by the pipeline. Rejected:
a `DO`-block that picks a schema per environment — it buys the house style at the cost of prod and
CI running different SQL, which is precisely the class of divergence that hides bugs.

Accepted cost: Supabase's `extension_in_public` advisor will flag this. `pg_trgm` exposes pure text
functions only — no data access, no elevated rights — and every app table's write DML is already
revoked from `anon`/`authenticated` (0045/0046). Verified empirically in both environments before
merge (test DB: `pg_extension` + `pg_indexes` + an unqualified `word_similarity()` call; CI: the
migration and the ranked integration tests running green).

## Consequences

- One new **extension**, zero new npm dependencies. `pg_trgm` is contrib, versioned with the
  server, and needs no upgrade choreography.
- Five GIN indexes on two small tables. Plain (non-`CONCURRENTLY`) `CREATE INDEX` per DM-13 and the
  0051/0052/0055 rationale: sub-millisecond `ShareLock` at current volume, placed now precisely
  while the tables are small.
- Ranking is a **server** concern. The overlay renders the order it is given; nothing re-sorts on
  the client (PRN-15).
- The `total` per group is still an exact `count(*)` over the same predicate — ranking touches
  ordering only, never the count.
- A future portal Ctrl-K remains blocked on `SearchScopeError`'s two documented preconditions.
  Nothing here relaxes them.
- SEC-05 unchanged: the query text is a bound parameter on both the match and the rank path, and
  is never logged — it can carry a seller's name or phone number.
