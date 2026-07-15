# WP-LS1 — "Lead Source 1" ingestion profile + MLS rules v2

Spec: ING-01..08, MLS-01..05, PRN-01/03/04/10, DM-08, SEC-05 · Tier: **A** (pipeline + MLS logic + migration)
Status: owner-approved direction (2026-07-15); this doc = the design spec. Plan doc + TDD build in a follow-up session.

## Goal

The platform's uploads are now a single CRM "opportunities" export (179 columns; samples:
`opportunities (11) (1).csv` = 68 rows, `opportunities (12).csv` = 114 rows, verified 2026-07-15).
Ingest it as the ONE active source, named **"Lead Source 1"** everywhere (code, UI, docs — no CRM
vendor name anywhere). The previous seed profiles (InvestorFuse, Generic) and the previous MLS
pattern set are retired for new runs. Historical runs keep their pinned snapshots (PRN-05/DM-08).

## Owner decisions (locked, 2026-07-15)

1. **MLS rule:** if ANY of the notes questions `Listed?`, `Listed with realtor?`, `Listed on MLS?`
   (and the archived `Is it Listed? :` form) answers **Yes/Y/True → the lead is MLS-listed → removed**.
   No/blank → kept (the engine's default-keep). Verified against all 182 sample rows: zero rows carry
   both a Yes and a No, so "any Yes wins" maps onto the existing engine with **no engine change** —
   it is purely pattern data.
2. **This export is the only upload format now.** Old profiles are ignored for new uploads.
3. **Skip-trace data is STRIPPED from canonical notes** (third-party phones/emails incl. DNC flags
   never reach partners); the untouched original row stays in `raw_json` (admin-side).

## Empirical baseline (what the spec is built on — all measured, not assumed)

- Parse path: the existing SheetJS reader (`src/modules/sources/parse.ts`) already handles this CSV
  (multiline quoted cells, emoji headers, UTF-8) — **no parser change**.
- Field coverage on 182 real rows: `Contact Name`/`phone`/`email`/`source`/`Created on`/`Notes`/
  `Property Address`/`Opportunity ID` = 100% populated. The dedicated `State`, `Seller 1 *`,
  `Timeline To Sell`, and all `⚪️ *` columns = **0% populated** (scaffolding; ignore).
- `Property Address` ("848 Caton Ave, Adrian MI 49221") decomposes to address/city/state/zip at
  **182/182** with `^(.*?),\s*(.+?)\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$`.
- Notes-blob extraction (two per-vendor templates inside the `Notes` column):
  `Reason For Selling:` / `* Reason for selling:` and `How Soon to Sell:` / `* Sale urgency:` = 100%.
- Listing answers: vendor A (`source=LeadZolo`) rows carry `Listed?` (112× Yes, 1× No);
  vendor B (`source=Real Estate Bees`) rows carry `Listed with realtor?` (69× No) and
  `Listed on MLS?` (16× No, rest blank). Under the owner rule: **112 removed / 70 kept**.
- The CURRENT seed pattern `on market` (bare) false-fires on the template label
  "MLS History / Days on Market:" in every vendor-A row → 57% false removals. It must not survive.
- 18 rows repeat across the two sample files (same CRM id AND address) — the existing
  address+zip5 dedupe (DED/PRN-05) handles re-uploads correctly, no change needed.

## Design

### 1. Source Profile "Lead Source 1" + a registered transform seam

- New seed profile `LEAD_SOURCE_1` (id `lead-source-1`, name **"Lead Source 1"**, version 1),
  header signature = the export's 179 columns; strictness `flexible` (extra CRM columns tolerated,
  drift on mapped columns still triggers the ING-08 diff-and-confirm flow).
- Direct column mappings: `campaign ← source`, `dateCreated ← Created on`, `phone ← phone`,
  `email ← email`, `notes ← Notes` (pre-strip; see §3).
- **New seam — derived extraction:** `SourceProfile` gains optional `transform?: string` naming a
  **registered pure transform** (registry in `src/modules/sources`; data names it, code implements
  it — same philosophy as MLS patterns). `applyProfile()` runs column mapping, then the transform:
  `transformLeadSource1(row, mapped) → canonical` (PURE, PRN-01; unit-tested against fixtures):
  - `sellerFirst/Last` ← `Contact Name`: first token → first, remainder → last. Never throws;
    odd names ("Paul. Lisa Hudson. Hudson") stay readable, imperfect by design (documented).
  - `address/city/state/zip` ← `Property Address` regex above; fallback = the Notes
    `Full Address:` / `* Address:` line (handles the vendor-B form with a county segment).
    Both fail → fields blank; the lead still ingests and flows to Unmatched (never dropped, PRN-03).
  - `reasonForSelling` / `timeToSell` ← the notes-template lines listed above (both vendor forms).
    `motivation` ← "" (no equivalent in this export).
  - `notes` ← stripped blob (§3).
- Seed set becomes `[LEAD_SOURCE_1]` only. Existing profile ROWS in the DB are deactivated, never
  deleted/mutated (DM-08 append-only; historical runs keep their snapshot).

### 2. MLS pattern set v2 (replaces the seed set for new runs)

Disqualifiers (all case-insensitive, **line-anchored**, `[ \t]*` only — `\s*` is BANNED in these
patterns because the notes are multiline and `\s` crosses line breaks, which would let a question
match an answer on a different line; proven during analysis):

| id | regex (String.raw) | fires on |
|---|---|---|
| `dq_ls1_listed_yes` | `^[ \t]*\*?[ \t]*listed\?[ \t]*:?[ \t]*(?:yes\|y\|true)\b` (m flag) | vendor-A `Listed? Yes` |
| `dq_ls1_listed_realtor_yes` | `listed[ \t]+with[ \t]+realtor\?[ \t]*:?[ \t]*(?:yes\|y\|true)\b` | vendor-B realtor question |
| `dq_ls1_listed_mls_yes` | `listed[ \t]+on[ \t]+mls\?[ \t]*:?[ \t]*(?:yes\|y\|true)\b` | vendor-B MLS question |
| `dq_ls1_is_it_listed_yes` | `is[ \t]+it[ \t]+listed[ \t]*\??[ \t]*:?[ \t]*(?:yes\|y\|true)\b` | archived-notes form |

**No keep-overrides in v2.** No/blank answers → default keep (MLS-03), which IS the owner rule.
The old free-text overrides (`not listed`, `off market`, `never listed`, `no mls`) and the bare
positives (`on market`, `active on mls`, `currently on market`, `mls status: active`) are retired
for new runs. (If a human-written "off market" correction should ever beat a vendor `Listed? Yes`,
that's a data-only re-add via the patterns table later — deliberately out of v2.)

Note `dq_ls1_listed_yes` is line-anchored so it can never match inside "Listed with realtor?" /
"Listed on MLS?" (substring containment) — pinned by corpus fixtures.

### 3. Notes stripping (SEC-05 boundary)

Canonical `notes` = the `Notes` blob minus the skip-trace block: the `Skip Trace Emails:` and
`Skip Trace Phones:` lines **including their values** (third-party PII + DNC flags). Everything
else stays — in particular ALL listing-question lines (the MLS filter runs on canonical notes)
and the seller's own contact lines. Full original preserved in `raw_json`. Pure function
(`stripSkipTrace(notes)`), fixture-tested on both vendor templates.

### 4. Migration + snapshot (DM-08)

One migration (next number free): reseed `mls_patterns` to the v2 set (old rows deactivated, not
mutated), insert the `lead-source-1` profile, deactivate the old profile rows, bump the rules
snapshot version. Apply to dev. Historical runs remain pinned to their original snapshots.

### 5. Tests (requirement-ID named; PRN-04 process = corpus first)

- **mls-corpus fixtures FIRST**: representative notes blobs for every combination found in the
  samples (vendor-A yes / vendor-A no / vendor-B realtor-no + mls-blank / vendor-B both-no /
  archived `Is it Listed? : Yes|True` / the "Days on Market" label trap / substring-containment
  trap). ⚠️ **Fixtures must be SANITIZED** — real seller names/phones/emails/addresses from the
  samples must NOT be committed (SEC-05); preserve structure, fake the PII.
- Transform unit tests: address decomposition (incl. fallback + both-fail → blank), name split
  (incl. the 4 odd names, structurally reproduced), notes-field extraction (both templates),
  skip-trace strip (strips values, keeps listing lines), date/phone normalization.
- Pipeline integration: an end-to-end sanitized mini-file through parse → profile → normalize →
  MLS → assign → dedupe, pinning kept/removed counts and that a re-upload of overlapping rows
  dedupes (PRN-05 revert).
- Golden/determinism: re-pin any pipeline goldens the new profile + pattern set invalidate.
- Drift: a header-mutation case proving ING-08 still fires on the new signature.

### 6. Out of scope (explicitly)

- No pipeline-column filtering: ALL rows in an uploaded file ingest regardless of the export's
  CRM pipeline/stage columns (open question #1 below if the owner wants otherwise).
- No UI redesign; the Rules page reflects the v2 pattern set automatically.
- No changes to assignment/dedupe/exports/portal.
- The InvestorFuse/Generic profile code paths remain in history (git) but leave the seeds.

## Open questions (defaults chosen; owner can override at plan review)

1. Sample file 11 is the CRM's "ACQUISITIONS" pipeline, file 12 the "JV" pipeline. Default:
   **ingest every row** of whatever file is uploaded (no pipeline filter). Override = filter rows
   by the `pipeline` column value.
2. `motivation` stays blank for this source (no equivalent field). Acceptable?
3. The export has a "Send to JV Partners" column — empty in both samples; ignored in v1 of the
   profile. Revisit if the CRM starts populating it.

## Acceptance

- Uploading either sample file succeeds end-to-end: 68/114 rows ingested; kept/removed matches the
  owner rule (sample totals: 112 removed as listed, 70 kept across both files); removed leads show
  the matched listing line highlighted (MLS-05); partner-visible notes contain no skip-trace data;
  all kept leads carry parsed address/city/state/zip and route by territory as normal.
