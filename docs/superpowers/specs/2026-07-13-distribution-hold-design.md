# Design — 10-minute distribution hold + only-latest void

_Phase A follow-on. Tier A (changes when leads reach partners + touches every partner-facing
read + a migration; cross-cutting, like WP-J2's soft-delete)._

## Goal

Today an import distributes to partners **instantly**: the moment `runUpload`
(`src/modules/run/run-upload.ts:73-78`) finishes, `enqueueRunDigests` emails partners and posts
in-app notifications, and the leads are immediately visible in the partner portal
(`listPartnerLeads` et al. have no "released" gate). So if an admin uploads the wrong file, void
has to *recall* leads partners may already have seen — and a digest may already have been sent.

**New behavior:** hold every import's leads for **10 minutes** before partners see or hear about
them. During that window the admin reviews; a void is completely clean (nothing was ever
distributed). After the window the leads **release** — visible + digested. And **only the latest
import can be voided.**

## Behavior spec

- **Import:** leads are processed and routed exactly as now, but **held** — invisible to partners,
  no digest, no notification. The admin sees everything immediately (admin reads are NOT gated).
- **Release (~10 min later):** the import's leads become partner-visible and the partner digest +
  in-app notifications go out (built from the import's leads).
- **Void:** allowed **only** for the **latest** import while it is **still held** (not yet
  released). Such a void stays clean — nothing was distributed, so no partner recall/notice.
  (The existing PII purge on void, WP-GL-B, still applies.)
- Once released, an import is committed — it can no longer be voided (there is no per-lead delete;
  that idea was dropped by the owner).

## Spec basis

- **ING-09** (void / poison-prevention) — re-implemented; the *intent* is preserved (undo a bad
  import before it reaches partners), the mechanism changes → **ADR**.
- **NTF-01/02/04** (digests, notifications) — timing shifts from import to release.
- **PTL-02/03/04** (scoped partner reads) — gated so held leads don't show.

## Mechanism

> **Post-review refinements (ADR-0026 is authoritative):** the ADMIN run-summary is sent at import
> (not deferred) with the true full-run summary + acting admin; only PARTNER digests defer to the
> release cron. Release + void share the same per-tenant advisory lock and void refuses an
> already-distributed run (`AlreadyDistributedError`). `APP_URL` fails the app's boot in production
> if unset. See ADR-0026.

**1. Visibility is self-releasing — time-based, no cron (the robustness choice).** A lead is held
from its partner while it is within the hold window of its import, computed AT READ TIME from the
lead's own `created_at` (≈ its import time). Every partner-scoped read adds `leads.created_at <=
now − HOLD_WINDOW` (released) — exactly parallel to the existing `isNull(deletedAt)` filter, no
join, using a pure `releaseCutoff(now)` helper. Because it is *computed*, not flipped by a job,
**a dead cron can never hide leads** — they appear on schedule regardless. Reappearing
(previously-matched) leads keep their ORIGINAL `created_at`, so they stay visible (correct — the
partner already had them; voiding this import doesn't touch them, they keep the prior `upload_id`).
Reads affected (all `src/modules/portal/queries.ts` unless noted), each already carrying the
`and(leadWhere, kept, isNull(deletedAt))` pattern the gate slots into:
- `listPartnerLeads` · `getPartnerLeadDetail` · `getPartnerExportData`
- `partnerPerformanceDetail` (`analytics/partner-performance.ts`, raw SQL — powers the portal dashboard)
- `listPartnerActivity` (`activity/queries.ts`)
- `updateLeadStatus` (`portal/status-update.ts`) — a partner can't act on a held lead
- portal notes (`notes/notes.ts` via the partner path)

Admin reads (`/leads`, `getRunDetail`, dashboard, analytics) are **not** gated — the admin reviews
held leads immediately. This bounds the blast radius to the partner surface.

**2. The push (digest + in-app notifications) → release cron.** Move `enqueueRunDigests` out of
`runUpload` (`run-upload.ts:72-78`); nothing notifies at import. A cron (piggyback the every-5-min
`drain-outbox`) sends it once per import at/after the window: for uploads where `status='processed'
AND created_at <= now − HOLD_WINDOW AND distributed_at IS NULL AND not voided`, set
`distributed_at`, `enqueueRunDigests`, drain. This is the ONLY part that uses the cron — and it is
**non-critical**: if it stalls, leads are still visible (point 1); only the heads-up
email/notification is delayed, and it self-heals on recovery. Idempotent via `distributed_at` +
a per-tenant advisory lock.

**3. Migration.** `uploads.distributed_at timestamptz` (NULL = push not yet sent) + a partial index
for the release scan. This marker is for the PUSH's idempotency ONLY — visibility needs no column
(point 1), which is what keeps a dead cron from ever hiding leads.

**4. Void guard (`src/modules/run/void.ts`).** The 10-minute window check (`isWithinVoidWindow`,
WP-J1) already exists and now doubles as the hold window — a within-window void is clean because
the leads were never visible (point 1). ADD: the upload must be the **latest** non-voided import
for the tenant (`NotLatestImportError` → 409). Skip the recall notice for held voids (nothing was
ever distributed).

## Decisions (my leans — please confirm)

1. **Full hold** (portal invisibility + held email), not email-only. Matches "partners don't have
   the leads during the window."
2. **No "send now" button** in V1 — always auto-release after the window. Easy to add later.
3. **10-minute hold**, released by the 5-minute cron ⇒ ~10–15 min effective. Fine for real estate.

## Risks / tradeoffs (the honest part)

- **Visibility no longer depends on the cron** (mechanism point 1) — the key robustness choice: a
  dead release cron delays only the notification email, never lead access, and self-heals on
  recovery. The load-bearing alarm is a **cron-specific heartbeat / dead-man's-switch (ACT-05)** —
  NOT the `/api/health` uptime alert, which can't tell a cron stopped while the site is up. Two
  different alarms; the cron heartbeat (external, independent watchdog) must ship with this.
- **The import itself is never at risk** — processing/routing stays synchronous at upload; only
  the partner-facing push is deferred.
- **Cross-cutting reads** (~6 partner paths) — same discipline WP-J2 needed; each gets a test, and
  a missed read = a held lead leaking early. The DB integration test is the safety net.
- **Slight delivery delay** (10–15 min) — negligible for this domain.

## Tests

- Held lead is invisible to every partner read; visible after release. (per-read)
- No digest/notification at import; digest + notification fire at release, once (idempotent job).
- Void: latest + held → ok; not-latest → `NotLatestImportError`; already-released →
  `AlreadyDistributedError`.
- Release job skips voided uploads; admin sees held leads immediately.
- Integration (live dev DB) proves the partner-isolation + timing end to end.

## Out of scope

Per-lead delete (owner dropped it); a manual "send now"; changing the 10-min value into a setting.
