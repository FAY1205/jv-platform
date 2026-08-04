# WP-J1 — Void grace window (10-minute void limit)

**Status:** design · **Branch:** phase-2/distribution · **Date:** 2026-07-12
**Inputs:** owner ⭐ decision F-2 (part 1 of 3) · current code: `src/modules/run/void.ts`,
`src/app/api/runs/[ref]/void/route.ts`, `src/app/imports/[ref]/page.tsx`
**Owner call (2026-07-12):** void should only work **within 10 minutes of the import** — a grace
window (a bounded "undo"), anchored to `uploads.createdAt` (owner: "use createdAt", no new column).
This is the first of two WPs; **WP-J2** adds the actual lead recall + notification.

---

## 1. Why

WP-J2 makes void *recall delivered leads from partners* — a destructive action. The owner wants it
bounded to a short window right after import, when partners have barely had time to act, so a stale
run can't be yanked out from under a partner who's been working it for days. WP-J1 lands the window
guardrail on its own first (no recall yet), so it can be reviewed and verified in isolation.

## 2. Design

### 2.1 Pure helper (TDD)

In a **new client-safe** module `src/modules/run/void-window.ts` (NOT `void.ts` — that imports
`@/db`, so a `"use client"` component cannot import from it). Both `voidUpload` (server) and the
import-detail UI import the one definition:

```ts
export const VOID_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/** Grace window: a run may be voided only within VOID_WINDOW_MS of its import (createdAt).
 *  `now` is injected so this stays pure/testable. Clock skew that puts createdAt slightly in
 *  the future (elapsed < 0) still counts as within the window. */
export function isWithinVoidWindow(createdAt: Date, now: Date, windowMs = VOID_WINDOW_MS): boolean {
  return now.getTime() - createdAt.getTime() <= windowMs;
}
```

### 2.2 Enforcement

`voidUpload` gains a new terminal error and one guard, ordered **after** the not-found and
already-voided checks (those are more specific and must win):

```ts
export class VoidWindowClosedError extends Error { /* name; message names the 10-min window */ }
```

```ts
if (!upload) throw new UploadNotFoundError(ref);
if (upload.status === "voided") throw new AlreadyVoidedError(ref);
if (!isWithinVoidWindow(upload.createdAt, new Date())) throw new VoidWindowClosedError(ref);
```

`new Date()` is fine here — `void.ts` is `src/modules/run`, not a `src/modules/pipeline` pure step
(PRN-01 does not bind it; it already calls `new Date()` for `voidedAt`). The **pure** check takes an
injected `now`.

### 2.3 Route

`src/app/api/runs/[ref]/void/route.ts` maps `VoidWindowClosedError` → **409** (uniform envelope
`{code:"void_window_closed", message, ...}`), alongside the existing not-found/already-voided cases.

### 2.4 UI

`src/app/imports/[ref]/page.tsx` — the void action disables + shows a short explanation
("Voiding is only available for 10 minutes after an import") once the window has closed. Window state
is computed from the run's `createdAt` at mount (a `useState` initializer snapshot, mirroring the
WS-4 `formatWaiting` `now` pattern — avoids a render-purity issue). The **server is authoritative**;
the disabled state is a courtesy, and a stale-but-enabled button is still rejected server-side.

### 2.5 The void copy is deliberately UNTOUCHED in J1

The void modal / banner / an invalidation comment say voiding "excludes every lead … from **future
dedupe, analytics and exports**" and "**recalls** … distributed leads." Today only `store.ts`
`loadHistory` (dedupe) is implemented — but this copy is **not false marketing**: it reflects the
**SPEC.md ING-09 commitment** ("excluded from dedupe, analytics, and exports … partner digests …
get a correction notice, and portal counts update"), tracked in `docs/backlog/WP-018.md` as Phase-2/3
follow-ups. **WP-J2 implements those clauses (partner-facing) — it is the natural home for the copy.**
J1 leaves the ING-09-aligned copy intact to preserve the spec↔code trace; the grace-window UX is
carried by the button gating + the closed-window banner, which touch no ING-09 language.

**Open for WP-J2 (spec-vs-decision divergence):** ING-09 reads "excluded from analytics and exports"
unqualified; the owner's F-2 recall decision is **partner-facing** (admin still sees reality). So the
**global/admin** analytics-exclusion clause (WP-018 "Phase 3") is NOT covered by WP-J2 and needs either
an owner decision to build it or an ADR to formally descope it. Flag at WP-J2 design.

## 3. Non-negotiables

- **PRN-01:** the pure window check takes an injected `now`; only the impure `voidUpload` reads the
  clock.
- **ING-09 / PRN-05:** void stays a soft-void (status flip + audit); no leads deleted or history
  rewritten. WP-J1 does **not** touch lead access at all — partners still keep voided-run leads until
  WP-J2. (The current void copy already says so truthfully.)
- **Scoping unchanged:** `voidUpload` remains tenant-scoped + admin-only (route guard); no new query.

## 4. Owner-visible behavior change

Runs **older than 10 minutes can no longer be voided** — including existing/seed runs. This is the
intended guardrail. (If a "reopen window" / admin-override is ever wanted, that's a follow-up.)

## 5. Tests

- **Unit** `tests/unit/void-window.test.ts` (NEW): `isWithinVoidWindow` — within (0, 5 min, exactly
  10 min) → true; past 10 min → false; future `createdAt` (negative elapsed) → true. Named
  `ING-09: ...`.
- **Integration** `tests/integration/void.test.ts` (extend): the existing happy-path still passes
  (`createdAt ≈ now`); add a case that **backdates** an upload's `createdAt` to 11 min ago and asserts
  `voidUpload` rejects with `VoidWindowClosedError`; keep the already-voided case (order preserved).

## 6. Verification & review

- `pnpm exec vitest run tests/unit/void-window.test.ts --no-file-parallelism` green; the void
  integration test green (serial, env-sourced); full unit suite green; `pnpm typecheck`; eslint.
- Review: **pr-reviewer** + **audit-api-contract** (the void route gains an error case — a JSON
  contract change). No scoped-read surface changes, so audit-tenancy is deferred to WP-J2.
- Owner walkthrough: show the void action disabled + explained on a >10-min-old run.

## 7. Out of scope (→ WP-J2)

Lead recall (partner read filter + KPI drop), the `void_notifies_partners` setting, and the recall
notification. WP-J1 is the window guardrail only.
