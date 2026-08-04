# WS-0 — Security & correctness — execution design

**Program:** REDESIGN-R3 · **Branch:** phase-2/distribution · **Baseline:** 74277f5
**Authority:** `docs/backlog/REDESIGN-R3.md` §4 WS-0 + `docs/audit/2026-07-09-full.md`.
This doc refines the locked WS-0 table into a concrete, file-level plan. It does not
re-open any locked decision. Landed as small independent commits before WS-1.

## Guiding constraints
- No `Delivered → Distributed` behavior change in WS-0 (that is WS-2/D5). Export
  text, digests, run summary keep "Delivered" here.
- Ref format stays **v1** in WS-0 (`LD-2026-#####`, `UP-2026-###`). The v2 migration
  is WS-1. All `RefSchema` regexes added in WS-0 use the v1 shapes.
- Pipeline purity (PRN-01), tokens-only (PRN-12), note-stream separation (PRN-13),
  additive overlay (PRN-05) unchanged.

## Item-by-item design

### 1. Effective-owner (F-01 / TR-1) — the anchor
**App layer** — `src/lib/scope.ts:41-43`. Replace the OR union with the effective
owner. Import `isNull`.
```ts
export function partnerOwnsLead(me: string): SQL {
  // Effective owner = manualPartnerId ?? partnerId. A manual overlay to a DIFFERENT
  // partner REVOKES the pipeline partner's access — the predicates DO overlap once a
  // matched lead is re-routed. (Audit F-01 / ASN-04.)
  return or(eq(leads.manualPartnerId, me), and(isNull(leads.manualPartnerId), eq(leads.partnerId, me)))!;
}
```
This transparently fixes `leadWhere`, `noteWhere`, `leadChildWhere`, `listLeads`
(`queries.ts:67` already coalesces the join), and partner-scoped reads.

**DB layer** — migration `0010_effective_owner_rls.sql`. The four leads-family policies
in `0001_rls_and_constraints.sql` key on `partner_id` only. Each must switch to the
**effective owner**, matching the app layer exactly:
- `leads_scope` (line 129): `partner_id = app_current_partner()` →
  `coalesce(leads.manual_partner_id, leads.partner_id) = app_current_partner()`
  (for a `for all` policy the `using` clause references the row's columns directly).
- `lead_notes_scope` subquery (line 141): `select id from leads where partner_id = app_current_partner()`
  → `... where coalesce(manual_partner_id, partner_id) = app_current_partner()`.
- `lead_status_history_scope` subquery (line 153): same coalesce swap.
- `listing_checks_scope` subquery (line 164): same coalesce swap.

Policies are recreated with `drop policy` + `create policy` (Postgres has no
`create or replace policy`). RLS is defense-in-depth (server uses the service role
which bypasses RLS), but the backstop must agree with `scope.ts` so the boundary is
identical at both layers.

> **Reconciliation (on record):** the audit *executive roadmap* (line 123) writes the
> RLS fix as `... OR manual_partner_id = app_current_partner()`. Taken literally that
> is the leaky OR form — it would let the original pipeline partner keep access. The
> *raw* audit-tenancy F-1 (lines 19-37) uses the `isNull`/effective-owner form and
> states "the predicates DO overlap once a matched lead is re-routed." The spec item
> only says "add `manual_partner_id` to the 4 policies" without pinning OR. We
> implement the **coalesce/effective-owner** form — the only form that closes the
> leak and matches the app layer. Documented in the migration header + commit.

**Tests** (`tests/integration/isolation.test.ts`): seed a re-routed lead
`partnerId=X, manualPartnerId=Y`; assert `leadWhere(partnerX)` excludes it and
`leadWhere(partnerY)` includes it (the divergence case the current suite lacks).
Extend the existing exact-set assertions (admin-sees-all) to include the new lead.
Add a PRN-05 overlay assertion: run `editLead` (partner `set`) on a matched lead and
assert `partnerId` + `matchMethod` are unchanged while `manualPartnerId` moved.

### 2. `editLead` recomputes dedupe/address-norm (F-01 data facet)
`src/modules/leads/commands.ts:149`. When `address` or `zip` is in the patch,
recompute `dedupeKey = computeDedupeKey(nextAddress, nextZip)` and
`addressNormalized` via `pipeline/normalize.ts`, using the *post-patch* values
(fall back to the current lead value when a field is not being edited). Write both
into the same `patch`. Pure helpers, no new I/O. Add a unit test if a pure seam
exists; otherwise cover via the command test.

### 3. Idempotent status update (F-12)
`src/modules/portal/status-update.ts:30`. Before inserting history+event, load the
lead's current status (latest `lead_status_history` row, else `DEFAULT_STATUS`).
If `status === current`, return `{ refId, status }` **without** inserting history,
inserting the event, or triggering the admin notification. This kills duplicate
history rows and duplicate admin emails. Covered in `portal-scope.test.ts`
(same-status POST → no new history row, no new event).

### 4. `RefSchema` on the new leads routes (F-13)
Add the v1 `RefSchema = z.string().regex(/^LD-\d{4}-\d{3,}$/)` guard to:
- `src/app/api/leads/[ref]/route.ts` GET **and** PATCH (currently unvalidated).
- `src/app/api/leads/[ref]/assign/route.ts` POST.
Return `jsonError("invalid_ref", …, 400)` on mismatch — matching the sibling
`status/route.ts` pattern already in place.

### 5. `sanitizeCell` on the 3 export paths (F-26)
`src/modules/export/render.ts`. The leads sheet already sanitizes; the partner-name
cells on three paths do not:
- group-header row (line ~165, color-OFF): `ws.addRow([sanitizeCell(label)])`.
- legend row (line ~194): sanitize `p.name`.
- summary per-partner row (line ~210): sanitize the `name (ref)` label.
`sanitizeCell` is currently module-private and only applied inside `leadRowValues`;
reuse it. No "Delivered" text change.

### 6. Pin MLS load order + golden reason fields (F-03 / TR-3)
- `src/modules/run/rules.ts:28`: add `.orderBy(schema.mlsPatterns.patternKey)` to the
  patterns query so first-match-wins is deterministic across identical rule sets.
  (Recodes are removed in WS-1; WS-0 pins MLS only, per the spec note.)
- `tests/unit/golden.test.ts`: add `patternKey: l.mlsPatternKey` and
  `span: l.mlsMatchSpan` to the `actual` projection; regenerate `golden.outcomes`
  to carry the new fields. This is an **additive** re-pin (no existing decision value
  changes) — distinct from the WS-1 semantic re-pin (recode removal + ref-ID). Noted
  in the commit so the "golden re-pinned once in WS-1" program rule is understood as
  the *semantic* re-pin.

### 7. Test-net repair (F-02 / F-50)
- `tests/integration/notifications.test.ts:77`: assert `deepLink === "/imports/UP-2026-020"`
  (code moved to `/imports/` in commit 5bfff30; confirmed in `outbox.ts:201`).
- Auto-load `.env.local` for integration: extend `tests/setup.ts` to call Node 22's
  `process.loadEnvFile('.env.local')` guarded by `existsSync` and only when
  `DATABASE_URL` is unset. Dependency-free (no `dotenv-cli` → no ADR needed). Unit
  tests are unaffected (they don't read `DATABASE_URL`).
- `tests/integration/auth-otp.test.ts`: make `cleanup()` cascade-safe (delete child
  rows before the tenant, ordered by FK) so an interrupted run cannot wedge the
  suite; it also clears the orphaned `test-otp-iso` tenant on next run.

### 8. Audit-trail completeness (F-05 partial / TR-5)
- Partner invite: add an `audit_log` insert (`action:"partner.invited"`) in the invite
  path (`admin/partners/[id]/invite/route.ts` / `provision.ts`).
- Admin session revoke: add `audit_log` insert (`action:"partner.session_revoked"`)
  in `sessions/[familyId]/revoke/route.ts` / `trusted-device.ts`.
- Demo seeder (`scripts/seed-demo-dataset.mjs:43`): stop deleting `audit_log` rows.
(The DB immutability trigger is WS-9, not here.)

### 9. `/dev/emails` prod guard (F-48)
`src/app/dev/emails/page.tsx`: `if (isProduction) notFound()` at the top of the
server component (the API already 404s; the page did not).

### 10. Dependency bump (F-46)
`pnpm update postcss exceljs` (or `pnpm.overrides` for `uuid ≥ 11.1.1`). Re-run
`pnpm audit --prod`. No ADR (patch/minor of existing deps).

### 11. Scope-builder sweeps (F-31/F-32/F-33 — spec-scoped subset)
- `findProfileById` (`sources/profile-store.ts:105`): move the tenant predicate into
  the WHERE (`and(eq(id), tenantWhere(...))`).
- `listPartnerActivity` (`activity/queries.ts:93`): scope through effective-owner
  ownership so a partner's activity on manually-assigned leads is not under-reported.
- `drainOutbox` (`outbox.ts:269`): make `tenantId` **required** in the options type.
  All three live callers already pass it (verified) — pure type tightening.
(The broader hand-rolled-filter sweep from F-31 stays a WP candidate; WS-0 does the
named subset only.)

### 12. Client cleanups (F-79/F-68/F-23)
- Notif-prefs save (`settings/notifications/page.tsx:38`): `invalidateQueries` on its
  own query key after a successful save.
- `/reset` missing-token (`reset/page.tsx:70`): make "request a new one" an actual
  link to the reset-request route.
- Deactivated-partner re-invite (`partners/page.tsx:312`): `canInvite = status !== "active"`,
  button label "Reactivate" when the partner is deactivated.

## Acceptance (WS-0 gate before WS-1)
- `pnpm test:unit` green (incl. the re-pinned golden).
- `pnpm test:integration` green against the dev DB **including** the new isolation
  divergence + PRN-05 overlay cases (env auto-loaded).
- `pnpm run typecheck` + `pnpm run lint` green.
- No "Delivered" text changed; ref format still v1.

## Out of scope (WP candidates, not built here)
Full F-31 hand-rolled-filter sweep · `events` writers for lead.assigned (WS-9) ·
leads-admin negative-path suite 403/404/409/422 (Next WP) · `audit_log` immutability
trigger (WS-9) · idempotency terminal-failure state (F-35).
