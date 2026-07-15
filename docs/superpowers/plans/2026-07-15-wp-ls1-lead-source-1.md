# WP-LS1 plan — "Lead Source 1" ingestion profile + MLS rules v2

Spec: [docs/superpowers/specs/2026-07-15-wp-ls1-lead-source-1.md](../specs/2026-07-15-wp-ls1-lead-source-1.md) (committed 7596c7a)
Tier: **A** (pipeline + MLS + migration) → owner sign-off on this plan BEFORE code; explicit go before commit AND before push.
Reviews: pr-reviewer + audit-pipeline (mandatory) + audit-data (migration).

## Verification done before planning (re-measured against the live samples, this session)

Ran the spec's proposed v2 patterns + address regex over all 182 real rows through the repo's own
SheetJS path. Everything the spec claims reproduces exactly:

| check | result |
|---|---|
| MLS v2 verdicts | **112 removed / 70 kept** ✓ (matches the locked owner rule) |
| which patterns fire | `dq_ls1_listed_yes` ×102, `dq_ls1_is_it_listed_yes` ×10; realtor/mls patterns ×0 (all vendor-B answers are No/blank — they are defensive, correctly) |
| `Property Address` decompose | **182/182** ✓ |
| overlap across the two files | **18** duplicate `address\|zip5` keys ✓ (existing dedupe handles it) |
| skip-trace shape | label + values on ONE line (`Skip Trace Emails: a@b; c@d`), never wrapped → a line-level strip is sufficient |
| headers | 179, all distinct after normalization, none blank → no mapping collisions |
| `phone` / `email` / `source` / `Notes` / `Opportunity ID` | 182/182 populated; 0 malformed phones (<10 digits), 0 malformed emails |
| `reasonForSelling` / `timeToSell` | **182/182** from the notes templates (both vendor forms) |
| `Created on` | ISO timestamp, survives the repo parse path intact (`cellDates:false` + `raw:false`) — see F6 |
| `State` / `Timeline To Sell` / `⚪️ *` cols | 0/182 — empty scaffolding, correctly ignored |

### Known extraction imperfections (measured, accepted)

- **Contact Name:** 178/182 are clean 2-token names. 4 are not (one two-people-in-one-field
  `Paul. Lisa Hudson. Hudson` form, three 3-token names) → first-token/rest puts a middle name in
  the last-name field. Readable, imperfect by design; original preserved in `raw_json`.
- **One malformed address** (CRM double-append: `… Denver, CO #####, USA, Denver CO #####`) parses to a
  garbage city string but the **correct state + zip** → assignment (which keys off zip5) is unaffected.
  Cosmetic on 1/182, not a routing defect.
- **Vendor-B `Yes` has zero live coverage** — `Listed with realtor?: Yes` / `Listed on MLS?: Yes` never
  occur in the samples (all No/blank). Corpus fixtures are their only proof. Deliberate.

Exact real question forms (these drive the regex craft):
`Listed? Yes` ×112 · `* Listed with realtor?: No` ×69 · `* Listed on MLS?:` ×53 · `* Listed on MLS?: No` ×16 ·
`Is it Listed? : Yes If Yes, MLS Date Active :` ×8 · `Is it Listed? : True …` ×2 · `Listed? No` ×1.

## Owner decisions at plan review (2026-07-15) — LOCKED

| # | decision |
|---|---|
| F1 | **Adopt the tolerant regex** (`mls[ \t]*\??`, `realtor[ \t]*\??`, `listed[ \t]*\?`). Verified: still 112/70, no new false fires. |
| F2 | **Ship v2 as locked** — only the vendor's structured listing questions remove a lead; free-text prose does not. The 5 v1 corpus cases are **re-pinned** to their v2 expectation with a `why:` recording the 2026-07-15 retirement (never deleted — PRN-04 institutional memory). |
| F3 | **Delete the old profile rows; NO new `active` column.** Verified against dev: one row (`Generic v1`), **zero** uploads reference it; prod is not live; `SEED_SOURCE_PROFILES` shrinks to `[LEAD_SOURCE_1]` in code, so the built-ins retire themselves. The `active` column was speculative — dropped ("prefer boring code"). ⚠️ `uploads.source_profile_id` FK is `onDelete: no action`, so the DELETE **must** be guarded: `WHERE id NOT IN (SELECT source_profile_id FROM uploads WHERE source_profile_id IS NOT NULL)` — safe, idempotent, and it never destroys a row that has history (DM-08 intent preserved). |
| F4 | Retiring v1 patterns via `enabled = false` accepted; called out explicitly for audit-data. |
| F5 | **Retire the InvestorFuse golden entirely.** No `MLS_PATTERNS_V1_ARCHIVED`. The new sanitized LS1 golden is the determinism pin. `DEFAULT_MLS_PATTERNS` becomes v2 outright. |
| F6 | **`dateCreated` is formatted to a plain date** (`2026-07-07`) in the transform. `Created on` is an ISO timestamp (`2026-07-07T17:30:37.714Z`) that flows straight to the partner Excel export ([export/render.ts:106](../../../src/modules/export/render.ts#L106)) and portal ([portal/queries.ts:341](../../../src/modules/portal/queries.ts#L341)). ⚠️ Implement by **regex-slicing** `^(\d{4}-\d{2}-\d{2})T` — NEVER via `new Date()`, which would apply the host timezone and could shift the day (PRN-01 determinism). Unparseable → pass the raw value through unchanged (never blank). |
| Q1 | Ingest every row — no pipeline/stage filter. |
| Q2 | `motivation` stays blank for this source. |
| Q3 | "Send to JV Partners" column ignored in v1. |

## Review round (2026-07-15) — what pr-reviewer / audit-pipeline / audit-data caught

All three mandatory reviews ran. Two found REAL defects, each verified by an independent probe
before acting (audit findings are not trusted on sight — see [[jv-leads-audit-finding-accuracy]]).

| # | finding | severity | resolution |
|---|---|---|---|
| R1 | **`getTransform` inherited `Object.prototype`** — `getTransform("constructor")` returned `Object` (a callable) instead of throwing; `applyProfile` invoked it and `Object(row, mapped)` returned the RAW row as canonical: no address, no name, **skip-trace + [DNC] values intact**, no error. The seam's one safety property was not implemented. | **High** (silent SEC-05 leak) | FIXED: registry is `Object.create(null)` + `typeof !== "function"` check. 5 inherited-name cases + an applyProfile leak case pinned. |
| R2 | **`buildConfirmedProfile` dropped `transform`** — every ING-08 drift-confirm would mint a transform-less v2 that SHADOWS the code seed ⇒ un-stripped notes to partners + every lead to Unmatched. (Found by the drift integration test, before audit-pipeline reported it.) | **High** (silent SEC-05 leak) | FIXED: `transform: input.base?.transform`. Unit + integration coverage. |
| R3 | **Signature pinned a Windows-1252 MISDECODE** — 21 of 179 headers were mojibake (`"â ï¸ Dispo Key Notes"` for `"⚠️ Dispo Key Notes"`). SheetJS decodes a BOM-less CSV as cp1252 and a BOM'd one as UTF-8, so the same export yields two header sets; the signature was *accidentally* right. A future BOM ⇒ 21-column phantom drift ⇒ the ING-08 gate drowns in noise and the profile flip-flops versions. | **Medium** | FIXED with owner sign-off ("do the industry best practice" — never infer an encoding): `codepage: 65001` pinned in `parse.ts`, signature re-extracted with real emoji. **Re-verified: both samples × {as-is, BOM'd} ⇒ `exact`, 0 mojibake, 112/70, 0 leaks, 18 dupes.** The old detection test was tautological (fed the signature back into itself); replaced with one driving real BYTES with and without a BOM. |
| R4 | **Migration idempotent but not convergent** — `ON CONFLICT DO NOTHING` could not repair a `dq_ls1_*` row left disabled/stale by a partial run: it would report success while silently under-removing (listed leads shipped to partners). | Low | FIXED: `DO UPDATE SET … enabled = true`. **Proven by sabotage**: disabled + corrupted `dq_ls1_listed_yes`, re-ran the INSERT, row repaired. |
| R5 | **Migration comment overstated the DELETE guard** — `uploads.source_profile_id` is never written by ANY code path, so the FK guard is structurally inert, not a verified protection of live history. | Low (honesty) | Comment corrected to state what the guard is actually worth; real fix spun out as a WP candidate. |
| R6 | Pattern-order invariant: the engine is first-match-wins and PERSISTS the winning id + span, the golden replays code-array order while production replays `ORDER BY pattern_key`, and `buildRulesSnapshot` sorts before hashing so `rulesHash` is order-blind and cannot catch a split. | Low | FIXED: added a guard test asserting `DEFAULT_MLS_PATTERNS` is id-sorted. |

Confirmed CONFORMS by review: PRN-01 purity (golden regenerated byte-identically), PRN-04 `\s` ban in
BOTH seeds, code/DB regex byte-identity, fixture sanitation, DM-08 history replay, PRN-03, PRN-05,
ASN-02, RLS parity.

## Findings as originally presented (kept for the record — decisions above supersede)

### F1. Regex craft: the realtor/MLS patterns are too strict (recommend fix)

The spec table writes `listed[ \t]+on[ \t]+mls\?` — a literal `?` **immediately** after `mls`. The
existing corpus has a real form `"Listed on MLS ? No"` (space before `?`), which that regex cannot
see. The spec's own `is it listed` pattern is already tolerant (`[ \t]*\??`); the other two just
aren't, inconsistently.

**Proposed:** make all four tolerant the same way — `mls[ \t]*\??`, `realtor[ \t]*\??`, `listed[ \t]*\?`.
**Verified:** still exactly 112/70 on the samples, no new false fires (the AI-prose lines like
"not listed on the MLS, which suggests…" still don't match — they lack a Yes answer). Recommend adopt.

### F2. The v1 MLS corpus conflicts with v2 in 6 cases — 5 are your decision landing, 1 was the bug above

I ran all 27 existing corpus cases against v2:

| case | v1 expects | v2 gives | why |
|---|---|---|---|
| `MLS-01: listed on mls? yes` | removed | kept | **the F1 bug** — fixed by F1, no longer a conflict |
| `MLS-01: active on mls` | removed | kept | free-text positive retired |
| `MLS-01: currently on market` | removed | kept | free-text positive retired |
| `MLS-01: mls status active` | removed | kept | free-text positive retired |
| `MLS-01: on market` | removed | kept | free-text positive retired (this is the 57%-false-removal trap) |
| `MLS-02 precedence: positive + override` | kept | removed | keep-overrides retired → `Is it listed? : yes` now wins |

The last five are the **direct, intended consequence** of your locked decision (any-Yes, no
keep-overrides). They are not regressions — but they are the platform quietly losing the ability to
catch a human-written "it's on market" in free text.

**Proposed:** do NOT delete these cases (PRN-04 says the corpus is institutional memory). Re-pin each
with its v2 expectation plus a `why:` line recording that it was a v1 rule retired by the 2026-07-15
owner decision. The knowledge stays; the expectation tracks the live rule.
**Confirm:** you accept that free-text "on market"/"active on mls" in notes no longer removes a lead —
only the vendor's structured listing questions do.

### F3. ⚠️ `source_profiles` has no deactivation column — the spec's "deactivate old rows" is not yet possible

Spec §1/§4 says existing profile rows are "deactivated, never deleted/mutated". Verified in
[src/db/schema.ts:167](../../../src/db/schema.ts#L167): the table has **no `active`/`enabled` column**.
`loadProfilesForDetection` returns the latest version per name unconditionally, so InvestorFuse/Generic
rows already seeded into dev would keep being detected after this WP.

**Proposed:** the migration ADDs `active boolean not null default true` to `source_profiles`, sets it
false for the old rows, and both `loadProfilesForDetection` and `listProfiles` filter on it. Per
CLAUDE.md this makes the WP a schema change → migration + RLS check + index shipped together.
**Confirm:** you want the column (vs. the weaker alternative: leave old rows and rely on the 179-col
signature out-scoring them, which I do NOT recommend — it's implicit and breaks the moment someone
uploads an old-format file).

### F4. Retiring the old pattern rows is an `UPDATE` on a rules table (DM-08 nuance — flagging, not blocking)

`mls_patterns` DOES have `enabled` ([schema.ts:160](../../../src/db/schema.ts#L160)) and `loadRunRules`
filters `enabled = true`. Retiring v1 = `UPDATE … SET enabled = false`. That is technically mutating a
rules-table row, which DM-08 warns against. I judge it correct: `enabled` is the column's designed
lifecycle purpose, the v1 pattern text is never altered, and historical runs reproduce from their
**pinned `rules_snapshot`**, not from these rows. Will be called out explicitly for audit-data.

### F5. Goldens: keep an archived v1 pattern set so historical reproducibility stays *proven*

`tests/unit/golden.test.ts`, `pipeline-fixtures.test.ts`, `mls.test.ts`, `run-plan/run-process`,
`void.test.ts`, `anonymize.test.ts` and 3 scripts all import `DEFAULT_MLS_PATTERNS`. Repointing that
constant at v2 invalidates the InvestorFuse golden.

**Proposed:** `mls-patterns.ts` exports `MLS_PATTERNS_V1_ARCHIVED` (the frozen v1 set, out of the seed)
and `DEFAULT_MLS_PATTERNS` becomes v2. The InvestorFuse golden test binds to the archived set — so it
keeps passing and now actively **proves DM-08's promise** (a run pinned to old rules still replays
identically). A NEW sanitized LS1 golden pins v2. `INVESTORFUSE_PROFILE`/`GENERIC_PROFILE` stay
exported (scripts + goldens import them) but leave `SEED_SOURCE_PROFILES`, which becomes
`[LEAD_SOURCE_1]` — matching the spec's "leave the seeds" wording.

## The spec's 3 open questions — confirming the defaults

1. **Pipeline-column filter:** default = **ingest every row** of an uploaded file regardless of the
   CRM's pipeline/stage column (file 11 = ACQUISITIONS, file 12 = JV). Confirm?
2. **`motivation` stays blank** for this source (no equivalent field in the export). Acceptable?
3. **"Send to JV Partners" column ignored** in v1 (empty in both samples). Confirm?

## Build order (TDD, PRN-04: corpus first)

1. **Fixtures first, all SANITIZED** (SEC-05 — no real seller PII committed):
   `mls-corpus.ts` gains LS1 cases (vendor-A Yes/No, vendor-B realtor-No + MLS-blank, both-No,
   archived `Is it Listed? : Yes|True`, the `MLS History / Days on Market:` label trap, the
   substring-containment trap `Listed with realtor?` vs `Listed?`), and the 6 v1 cases are re-pinned
   per F2. New `tests/fixtures/lead-source-1-week.ts`: structure-faithful, fully faked PII.
2. **Pure transform + registry** (PRN-01): `src/modules/sources/transforms.ts` —
   `transformLeadSource1` (name split, address decompose + `Full Address:`/`* Address:` fallback +
   both-fail → blank → Unmatched never dropped (PRN-03), notes-template extraction both vendor forms,
   `stripSkipTrace`). `SourceProfile.transform?: string`; `applyProfile` runs mapping → transform.
   Unknown transform name **throws** (fail loud — a silent skip would ship undecomposed leads).
3. **Seed profile** `LEAD_SOURCE_1` (179-col signature, flexible) → `SEED_SOURCE_PROFILES = [LEAD_SOURCE_1]`.
   `INVESTORFUSE_PROFILE`/`GENERIC_PROFILE` stay exported only if a surviving test/script still needs
   them; otherwise they go too (F5 retires their golden).
4. **MLS v2 seed** — `DEFAULT_MLS_PATTERNS` = the 4 tolerant line-anchored disqualifiers
   (`[ \t]*` only, `\s*` banned; no keep-overrides). No archived v1 set (F5).
5. **ONE migration** (`0023_lead_source_1.sql`): insert the LS1 profile row; **guarded** DELETE of the
   old profile rows (F3); reseed `mls_patterns` to v2 + `enabled = false` on v1 rows; RLS + index
   parity; bump the rules snapshot. Apply to dev.
6. **Tests:** transform units, MLS corpus, an end-to-end sanitized mini-file through
   parse→profile→normalize→MLS→assign→dedupe pinning kept/removed, a re-upload dedupe case (PRN-05),
   an ING-08 header-drift case on the new signature, re-pinned goldens.
7. **Verify:** `pnpm test:unit -- --no-file-parallelism`, targeted integration, `pnpm typecheck`,
   eslint changed files; then a live upload of a sample CSV at localhost:3000 (you do the final eyeball).
8. **Reviews:** pr-reviewer + audit-pipeline + audit-data → PLAYBOOK §6 checklist → your go to commit → your go to push.

## Out of scope (per spec §6)

No pipeline-column filtering, no UI redesign, no assignment/dedupe/export/portal changes.
Vendor name never appears in code/UI/docs — "Lead Source 1" only.

## Risks

- **179-column signature** is verbose but mechanical; `MATCH_THRESHOLD` 0.5 means ≥90 columns must be
  present to detect — comfortable.
- **Old-format uploads** after this WP fall to `unknown` → inline mapping (intended; old format retired).
- Vendor-B realtor/MLS patterns have **zero live coverage** in the samples — corpus fixtures are their
  only proof. Deliberate: they encode the owner rule for when the vendor starts answering Yes.
