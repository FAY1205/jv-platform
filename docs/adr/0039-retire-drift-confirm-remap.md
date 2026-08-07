# ADR-0039 — Retire the in-app drift/unknown remap-and-confirm flow

**Status:** Accepted (2026-08-06)
**Supersedes (in part):** the ING-08 "diff-and-confirm" *remap UI* — see CLAUDE.md / SPEC ING-08.

## Context

ING-08 says: *"never silently re-guess a changed file format — drift goes through the
diff-and-confirm flow."* Two behaviors were built to satisfy it:

1. **Detection (kept).** `detectProfile` classifies an upload's headers against saved Source
   Profiles: `exact` (auto-process), `missing_required` (hard block), `drift` (partial match /
   rename / removal), `unknown` (no meaningful match). This is the real safety — a changed file
   is *detected*, never silently mis-parsed.
2. **Remap-and-confirm (retired here).** On `drift`/`unknown` the server returned a full mapping
   payload (`suggestMapping`, canonical fields, diff) and a second endpoint, `POST
   /api/uploads/confirm`, let an admin remap columns and save a **new Source Profile version**.

The confirm flow was **never wired into the client** — the upload page always treated a
non-match as "unsupported format," and `/api/uploads/confirm` had zero callers or tests. The
upload page already carried the owner's product decision in a comment: *"end users are NEVER
shown a column-mapping/confirm screen — a new format is added in code by the developer."* The
platform ingests a **single format ("Lead Source 1")**; adding a format is a code change
(a seed profile + a pure transform), not a runtime, self-serve action.

So we had a fully-built, unreachable feature (an audit High: built-but-dead code on a Tier-A
flow) sitting behind a screen that already said "no self-serve mapping."

## Decision

Retire the **remap-and-confirm** capability; keep **detection**.

- Delete `POST /api/uploads/confirm` and `src/modules/sources/mapping.ts`
  (`suggestMapping` / `buildConfirmedProfile` / `missingRequiredFor` — the remap-only layer).
- `POST /api/uploads` no longer returns a mapping payload for `drift`/`unknown`. It returns a
  lean `{ result: "unrecognized", profileName, diff }` and the upload page reports it back with
  the **specific columns that are off** (renamed / missing), plus the template download and a
  "choose another file" action. `missing_required` still hard-blocks with its own message.
- ING-08's intent — **never silently re-guess** — is preserved and arguably sharpened: a
  non-matching file now fails *loudly and specifically*, rather than dead-ending on a generic
  message or a screen that never shipped.

Retained, untouched: `detectProfile` + the header diff (`signature.ts`), `loadProfilesForDetection`
and `findProfileById` (the template route resolves the seed by slug through it),
`saveProfileVersion` / `createNextVersion` (the DM-08 versioning primitives, still covered by
their own tests), and the whole Lead-Source-1 parse/transform pipeline.

## Consequences

- **Adding a second format is a code change** (a new seed profile + transform), which matches
  how it already worked in practice. If a self-serve mapping UI is ever wanted, it is a new WP;
  the detection layer it would build on is intact.
- Dead code and an unreachable endpoint are gone; the "unrecognized format" message is now
  actionable (names the drifted columns).
- CLAUDE.md's ING-08 wording is updated to point here (drift → loud actionable rejection, not an
  in-app remap).
- Tests: `mapping.test.ts` removed; the confirm/remap cases in `drift.test.ts` and
  `sources-lead-source-1.test.ts` removed; the **detection** cases (drift/unknown/exact are still
  surfaced) are kept — they are the safety this ADR preserves.
