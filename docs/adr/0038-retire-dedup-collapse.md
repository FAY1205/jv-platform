# ADR-0038: Retire dedup collapse — every imported row becomes a lead

- **Status:** Accepted
- **Date:** 2026-08-04
- **Phase / WP:** Post-go-live (owner decision, 2026-08-04 session)

## Context

Since WP-015, the import pipeline collapsed duplicate rows: a row whose
`dedupe_key` (normalized address + zip5, DM-01) matched a prior non-voided lead —
or an earlier row in the same file — was **not** persisted. The recognized repeat
reverted to its original partner/method (PRN-05), was excluded from the partner
digest, and the `previously_matched` flag was meant to surface "returning" leads.

Two problems emerged in production use:

1. **The surfacing half never worked.** Duplicates were never persisted under the
   new upload, so `previously_matched` was `false` on every stored row — the admin
   badge, portal "· returning" tag, export column/summary row, digest counts, and
   dashboard total were all permanently dead (they only rendered on seeded demo
   data, which sets the flag directly).
2. **The collapse discarded data.** A re-inquiry's fresh form answers (new phone,
   notes, motivation) were dropped entirely; the partner was never told the seller
   came back.

The owner's product position (this session): **every submission is a lead worth a
call** — an event model, not an entity model. "Same address" does not reliably
mean "same deal" (house re-sold by a new owner; spouse submitting for the same
house is the same deal but the partner is calling either way). More data beats
missing data; duplicates are acceptable and visible rather than silently merged.

## Decision

1. **Retire the dedup collapse.** `planRun` no longer consults history or
   collapses within-run repeats; `processRun` no longer loads history; the store
   inserts **every** row as a lead (no `ON CONFLICT`, no ref-id gaps, no
   previously-matched filter). `src/modules/pipeline/dedupe.ts` is deleted.
2. **Keep the fingerprint, drop the constraint.** `leads.dedupe_key` is still
   computed and stored (same-house submissions stay groupable/reportable, and the
   collapse can be resurrected without backfill), but the partial UNIQUE index
   became a plain index (migration 0034). The inert `previously_matched` /
   `original_partner_id` columns remain in the schema, unwritten.
3. **Remove every returning-lead surface**: run-summary/analytics fields, admin
   "prev. matched" badge + Flags column, portal "· returning" tags, export
   "Previously Matched" column and "Previously matched" summary row (deliberate
   EXP-02 contract change), digest lines, AI mask field. The TST-05 golden was
   deliberately regenerated without the `prev` field.
4. **Guard the worst accident, softly.** With dedup gone, re-importing the same
   file duplicates and redistributes every lead. The client now fingerprints the
   raw file (SHA-256, `uploads.content_hash`, migration 0035); an identical
   non-voided prior import triggers `result: "duplicate_file"` and the upload page
   shows a warn panel — **"Import anyway"** (`confirmDuplicate: true`) pushes
   through. Warn-and-allow, never block (owner decision).

## Consequences

- Re-importing an overlapping (not identical) file **creates and distributes new
  copies** of the overlapping leads — intended behavior under the event model.
- If coverage changes between two submissions of the same house, the copies can
  route to **different partners**. Accepted; noted as the main business risk.
- The funnel is now strict arithmetic: Imported = Removed + Distributed + Unmatched.
- `first_matched_at` now always equals the run timestamp (no historical carry).
- Spec deltas: DED-01/02 retired; DED-03 amended (every row persists); DM-01
  amended (key stored, not unique); DM-03 amended (`previously_matched` inert);
  EXP-02 column contract amended. PRN-05 is unaffected for manual assignments
  (the overlay remains additive and immutable).
- Parked for a future WP (not built): a "Returned" lead status appended on
  re-inquiry (dormant-only flip), and a dedup time window — both deferred until
  the owner understands users' business process.

## Alternatives considered

- **Seller name in the dedupe key** — rejected: breaks the spouse case (same deal,
  different name), and names are the dirtiest field in the data.
- **Hard-block identical files** — rejected by owner in favor of warn-and-allow.
- **Keep collapse + fix the persistence gap** (make `previously_matched` real) —
  rejected by owner pending real-user process knowledge.
