# ADR-0026: 10-minute distribution hold + only-latest void (ING-09 re-implementation)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Phase / WP:** Phase A (Go-Live) / distribution-hold

## Context

Before this change, an import distributed to partners **instantly**: the moment `runUpload`
finished, partner digest emails + in-app notifications went out and the leads were immediately
visible in the partner portal. Voiding a wrong file (ING-09) therefore had to **recall** leads
partners might already have seen, and a digest could already have been sent — so WP-J2 added a
"N leads withdrawn" recall notification to soften that.

The owner (2026-07-13) chose a cleaner model: **hold** every import's leads from partners for a
short review window, so a void inside that window is completely clean (partners never saw the
leads, so there is nothing to recall). SPEC ING-09/NTF-01 describe the old instant-distribute
mechanism; this changes the mechanism while preserving ING-09's intent (undo a bad import before
it reaches partners) — hence this ADR.

## Decision

- **Hold window = 10 min** (`HOLD_WINDOW_MS === VOID_WINDOW_MS`). A new import's leads are held from
  partners until the window elapses.
- **Visibility is self-releasing, computed at read time** from the lead's own `created_at`
  (`releaseCutoff`/`isHeld` in `src/modules/run/hold-window.ts`; drizzle `releasedLeads()`). Applied
  to every partner-scoped lead read; admin reads are never gated. Because it is computed, **a dead
  release cron never hides leads** — it only delays the notification email.
- **The partner "push" (digest email + in-app) is deferred to a release cron** (`releaseDueImports`,
  wired into the every-5-min drain-outbox cron). The **admin run-summary is sent at import** (the
  admin isn't a partner and has the exact full-run summary + acting-admin context).
- **Void guard:** only the **latest** non-voided import, and only while **still held**
  (`AlreadyDistributedError` as defense-in-depth against the boundary race; `NotLatestImportError`).
  Release and void share the **same per-tenant advisory lock**, so they can't interleave.
- **The recall notification + its `void_notifies_partners` setting are removed** — with the hold,
  an allowed void is always still-held, so there is never anything to recall.

**Alternatives considered:**
- *Delay the email in the outbox, keep visibility instant.* Rejected — visibility must also be held,
  or a partner could see (then lose) a lead during the window.
- *Cron-flipped visibility flag on the upload.* Rejected — ties lead access to the cron running; the
  self-releasing `created_at` gate is strictly more robust.
- *Recompute the admin summary at release.* Rejected — it undercounts repeat leads (they keep their
  original `upload_id`); sending it at import with the true summary is correct and simpler.

## Consequences

- **Easier:** a within-window void is clean (no recall, no partner notice); the admin sees the
  result live at import; the WP-J2 recall machinery is gone.
- **Load-bearing dependency:** distribution now leans on the release cron. Visibility self-releases
  regardless, but the **cron heartbeat / dead-man's-switch (ACT-05)** must ship so a stalled cron
  (which would silently stop digest emails) is detected — this is NOT covered by the `/api/health`
  uptime alert. **`APP_URL` must be set in production** (release-cron email links); the app refuses
  to boot in production if it is left at the localhost default.
- **Trade-off:** ~10–15 min delay before partners are notified (negligible for real estate).
- **Reopened by:** changing the window length, or a per-lead delete path (explicitly dropped here).
- **Follow-up (deferred WP candidates):** centralize the hold gate inside the `scope.ts` builders
  (audit-tenancy F-1); a "Held — releases at HH:MM" badge on the import detail page (pr F-7).

## SPEC deltas

- **ING-09** — voiding is a bounded undo *before distribution* (within the hold window, latest
  import only); it no longer recalls already-distributed leads or sends a correction notice.
- **NTF-01** — partner digests fire at **release** (window close), not at upload completion.
