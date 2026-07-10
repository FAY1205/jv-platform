# WS-5 — Partners — execution design

**Program:** REDESIGN-R3 · **Branch:** phase-2/distribution · **Baseline:** WS-4 head
**Authority:** `docs/backlog/REDESIGN-R3.md` §4 WS-5. No locked decision reopened.

Two surfaces: the **roster** (`/partners`) and the **profile** (`/partners/[id]`).

## Locked inputs / bounds
- Roster becomes a **pure management table** (no lead-count / untouched columns); the
  `healthByPartner` full-history scan is deleted from the roster path (F-10).
- Profile: performance section = stat cards + Recharts history (given / contacted / closed
  over time) + Avg Contact using the WS-2 single-source formula/tooltip; **per-partner
  SQL-scoped queries** (no roster recompute). Territory keeps the existing state-level
  `CoverageMap` (already scoped to the partner). F-55 (deferred from WS-3): the profile's
  recent-leads ref-ids open `LeadDialog`.
- Consume WS-1 primitives: `Dialog` (replaces `Modal`), Radix `Select` (replaces
  `NativeSelect`), `Input`, `Textarea`, `LineChart`, `Tooltip`, `RowOpenButton`,
  code-split `LeadDialog`. No raw select/input/Modal/NativeSelect left on either page.
- Invariants: PRN-08 scope guard, PRN-12 tokens, PRN-13 (admin notes stay admin-only),
  PRN-14 partner name+ref+color, PRN-15 (analytics single home). Effective owner =
  `coalesce(manual_partner_id, partner_id)`.

## A. Roster backend — drop the health scan (F-10)
`src/modules/partners/queries.ts`:
- `PartnerRow`: **remove** `leadCount`, `untouched`, `oldestUntouchedDays`,
  `avgFirstTouchHours`. Keep `zipCount`/`stateCount` (territory summary) + partner fields.
- `listPartners`: **remove** the `healthByPartner(scope)` call AND the effective-partner
  `counts` (leadCount) query. Keep the zip/state count queries.
- **Delete** `src/modules/partners/health.ts` + `tests/unit/partner-health.test.ts` +
  the `computePartnerHealth` import (now unused).
- `getPartner`: stop calling `listPartners` (roster recompute). Fetch the single partner
  row directly (tenant-scoped, `eq(id)`, `isNull(deletedAt)`) + `territoryOf`; return the
  trimmed `PartnerRow & { territory }` or null.

## B. Profile performance — SQL-scoped facts + pure aggregator (PRN-15)
New `src/modules/analytics/partner-performance.ts`:
- **Pure** `buildPartnerPerformance(range: RangeKey, now: Date, facts: PartnerLeadFact[]):
  PartnerPerformance` where
  `PartnerLeadFact = { receivedAt: string; firstTouchAt: string | null; closedAt: string | null }`
  and
  ```
  PartnerPerformance = {
    range: { key: RangeKey; start: string; end: string; bucket: "day" | "month" };
    stats: { given: number; contacted: number; closed: number; avgContactHours: number | null };
    history: { bucketStart: string; given: number; contacted: number; closed: number }[];
  }
  ```
  Uses `rangeWindow` (WS-2). `given` = facts received in range; `contacted` = first-touch in
  range; `closed` = closed in range; `avgContactHours` = mean(firstTouch − received) hours
  over contacted, formatted by the caller with `formatContactTime`. `history` = zero-filled
  buckets between the window bounds, each bucket counting given/contacted/closed events that
  fall in it (each event bucketed by its own date). Unit-tested.
- **Async** `partnerPerformanceDetail(scope, partnerId, range)`: SQL-scoped fetch of the
  partner's kept leads (effective owner = partnerId, not deleted) with per-lead
  `firstTouchAt = least(min non-New status ts, min partner-note ts)` and
  `closedAt = max Closed status ts` (partner notes filtered `author_role='partner'`,
  PRN-13) via CTEs bounded to this partner, then `buildPartnerPerformance`. This is the
  single home of these numbers (PRN-15); tenant-scoped via `tenantWhere`/`partnerOwnsLead`.
- Route `GET /api/admin/partners/[id]/performance?range=` (Zod range enum, default `12mo`).

## C. Roster UI (`/partners`)
- Table columns: **Partner · Contact · Status · Coverage · Actions** (drop Leads +
  Untouched). Trim the client `Partner` interface to match the new `PartnerRow`.
- `PartnerForm` + `DeactivateModal`: `Modal` → `Dialog`; the deactivate reassign target
  `NativeSelect` → Radix `Select` (its `__placeholder__`-free option list; the reassign
  radios stay — native radios are accessible and have no WS-1 primitive). Existing `Input`/
  `Textarea` already used.

## D. Profile UI (`/partners/[id]`)
- Trim the client `Partner` interface (no health fields).
- **Performance section (new):** a range `Select` (7d/30d/12mo/All, default 12mo) driving
  `/api/admin/partners/[id]/performance`; stat cards Given · Contacted · Closed · Avg
  Contact (Avg Contact rendered with `formatContactTime` + a `Tooltip` carrying
  `AVG_CONTACT_DEFINITION`); a Recharts `LineChart` of the `history` series (Given /
  Contacted / Closed over time, PRN-14 named series).
- **Territory:** keep the existing `CoverageMap` scoped to the partner.
- **Recent leads:** ref-id → `RowOpenButton` opening the code-split `LeadDialog` (F-55);
  render `<LeadDialog>` on an `openRef` state. Adopt `matchMethodLabel` (F-57) for the
  non-manual match badges; "manual" stays a local special case (it is not a
  `matchMethodEnum` value).
- Admin notes panel stays (PRN-13, admin-only).

## E. Out of scope / deferred
- `Modal`/`NativeSelect` global deletion (end of WS-8).
- The `/leads/[ref]` old read-only page deletion (now that WS-3–WS-5 all open the dialog,
  this can happen at WS-8 with the Modal/NativeSelect sweep).

## F. Testing
- *Unit* (`partner-performance.test.ts`): `buildPartnerPerformance` — given/contacted/closed
  range bounding; Avg Contact excludes untouched; history zero-fill + per-event bucketing.
- *Integration* (`partner-performance.test.ts` integration OR extend `partners.test.ts`):
  `partnerPerformanceDetail` scoped to one partner counts only its effective-owned kept
  leads; a note-only contact counts (PRN-13 partner notes); a re-routed lead counts for the
  manual owner. `listPartners` no longer returns health fields (type-level + a shape assert).
- UI verified by `typecheck`/`lint` + owner walkthrough (auth-gated, as prior WSs).

## G. Commit sequence
1. Roster backend: trim `PartnerRow`, drop `healthByPartner` + counts, delete `health.ts` +
   test, direct `getPartner`.
2. `partner-performance.ts` (pure + async) + route + unit & integration tests.
3. Roster UI (columns + Modal→Dialog + Select).
4. Profile UI (performance section + Recharts + F-55 dialog + trim).

## Acceptance (WS-5 gate)
- Roster is a pure management table; no `healthByPartner`/roster-recompute on the roster or
  profile path (F-10).
- Profile has a per-partner performance section (stat cards + Recharts history + Avg Contact
  tooltip) from SQL-scoped queries; territory map scoped; recent leads open `LeadDialog` (F-55).
- No raw select/input/Modal/NativeSelect on either page.
- `pnpm test:unit` + `pnpm test:integration` (sequential) green; `typecheck`/`lint` clean.
