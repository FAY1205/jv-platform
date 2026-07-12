# WP-M — Portal GET-route Zod query validation + shared page primitive (design)

**Date:** 2026-07-12 · **Status:** proposed, pending owner review · **Depends:** WP-F.3 (portal dashboard/territory Zod range) — committed.
**Inputs:** the cleanup menu **slice E** ("Zod-ify all portal GET routes uniformly"); CLAUDE.md "Zod-validate every API input; uniform error envelope"; the canonical admin query schemas (`src/modules/{leads,activity}/schema.ts`); `src/lib/http.ts` (the `{code,message,traceId}` envelope, "Inputs are Zod-validated at the boundary").
**Scope:** input validation at the two portal `?page` GET boundaries + one shared page primitive. **No query/scope/contract changes.**

## 1. Context — a real-but-benign conformance gap + a duplicated primitive

The 7 portal GET routes were audited. Validation state:

| route | param | current | status |
|---|---|---|---|
| `dashboard` | `?range` | `z.enum(RANGE_KEYS).catch("30d")` | ✅ Zod (WP-F.3) |
| `territory` | — | none | ✅ (no param) |
| `leads/export` | — | none | ✅ (no param) |
| `leads/[ref]` | `ref` path | `z.string().regex(...).safeParse` → 400 | ✅ Zod |
| **`leads`** | `?page` | `Number(...)` + manual `>0 ? raw : 1` clamp | ❌ ad-hoc |
| **`activity`** | `?page` | `Number(...)`, **no clamp at the boundary** | ❌ ad-hoc |

The two `?page` routes violate the "Zod-validate every API input" rule. The gap is **benign today** — both query layers defend internally: `listPartnerLeads` uses standard `LIMIT/OFFSET`; `listPartnerActivity` clamps `current = Math.max(1, Math.floor(page) || 1)` (so NaN/negative → 1). So this is a **discipline/conformance + DRY** fix, not a live crash.

Two real sub-findings:
1. **The canonical `page` transform is duplicated verbatim** in `leads/schema.ts:24-27` and `activity/schema.ts:14-17` (and `pageSize` likewise) — a DRY smell the "uniform" work should collapse.
2. **`listPartnerActivity` uses `.limit(current * PAGE_SIZE)`** (`activity/queries.ts:124-141`) — it fetches *everything up to* the requested page, then merges/sorts/slices in memory. Reachable today via `?page=<huge>` on the portal activity route (which doesn't cap). Not an unbounded DoS (a huge `LIMIT` still returns only the partner's actual rows, and a partner's data is bounded), but poor pagination whose worst case a boundary cap should bound.

## 2. Confirmed decisions (owner, 2026-07-12)

1. **Shared primitive reused everywhere** — extract the canonical `page` transform to one shared factory; use it in the 2 portal routes AND refactor the 2 admin schemas to consume it (removes the duplication; behavior-preserving).
2. **Defensive portal page cap now + track the redesign** — the portal page schema gets a sane upper clamp (partners' data is bounded, so it never affects legit use and it bounds the `listPartnerActivity` window's worst case); admin stays **uncapped** (large tenants page deep). The `listPartnerActivity` pagination redesign is tracked as its own WP candidate (the real fix).

## 3. Design

**New `src/lib/query-params.ts`** (a boundary-input util, sibling to `http.ts`):

```ts
import { z } from "zod";

/** The canonical page-number transform: coerce → floor → >=1 else 1, optionally
 *  clamped to a max. Graceful (never 400), matching the "invalid filters degrade
 *  to defaults" rule. `.parse(searchParams.get("page"))` handles string | null. */
export function pageParam(opts?: { max?: number }) {
  return z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    let p = Number.isFinite(n) && n >= 1 ? n : 1;
    if (opts?.max != null && p > opts.max) p = opts.max;
    return p;
  });
}

/** Rows-per-page whitelisted to {10,20,50}, default 20 (mirrors Pagination.PAGE_SIZES). */
export function pageSizeParam() {
  return z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    return n === 10 || n === 50 ? n : 20;
  });
}

/** Portal list ceiling. A partner's data is inherently bounded, so this never
 *  affects legitimate paging; it bounds pathological `?page=<huge>` (esp. the
 *  listPartnerActivity in-memory window). Admin stays uncapped. */
export const PORTAL_MAX_PAGE = 1000;
```

**Portal routes** — replace the ad-hoc parse:
- `src/app/api/portal/leads/route.ts`: `const page = pageParam({ max: PORTAL_MAX_PAGE }).parse(new URL(request.url).searchParams.get("page"));`
- `src/app/api/portal/activity/route.ts`: same. (Keeps every other line — scope guard, ToS gate, `jsonOk`/`jsonServerError` — untouched.)

**Admin schemas** — swap the inline transforms for the shared factory (uncapped, behavior-identical):
- `src/modules/leads/schema.ts`: `page: pageParam(),` `pageSize: pageSizeParam(),`
- `src/modules/activity/schema.ts`: `page: pageParam(),` `pageSize: pageSizeParam(),`

## 4. Non-goals (explicit)

- **The `listPartnerActivity` pagination redesign** — its `.limit(page*PAGE_SIZE)` fetch-everything-up-to-page + in-memory merge/sort/slice. Tracked as a WP candidate; out of scope here (a query-semantics change with its own tests). E only bounds the blast radius via the cap.
- The already-validated routes (`dashboard` `.catch`, `leads/[ref]` `.safeParse`→400, no-param routes) — unchanged. `.catch` vs 400 policy stays as-is (a soft `?page` degrades to 1; a bad resource `ref` is a hard 400 — the codebase's own, correct distinction).
- No changes to any query, scope guard, ToS gate, error envelope, or JSON response shape. Admin route behavior is byte-identical (the extraction is behavior-preserving).

## 5. Tests (TDD the pure primitive)

New `tests/unit/query-params.test.ts` — `pageParam` / `pageSizeParam` are pure Zod schemas, ideal for red-green TDD. Cases (names carry the closest requirement ID — FEP-03 server-side pagination / PTL-02 / ACT-02):
- `pageParam()`: `"1"→1`, `null`/missing`→1`, `"0"→1`, `"-5"→1`, `"abc"→1`, `"2.9"→2`, `"3"→3`.
- `pageParam({ max: 1000 })`: `"1000"→1000`, `"1001"→1000`, `"999999999"→1000`, `"5"→5`.
- `pageSizeParam()`: `"10"→10`, `"50"→50`, `"20"→20`, `"37"→20`, missing`→20`.

Admin-schema behavior is covered by the extraction being byte-identical + the existing `LeadsQuerySchema`/`ActivityQuerySchema` tests (if any) staying green. Optional light route assertion (garbage `?page` → 1; `?page=huge` → cap) noted but not required — the pure primitive carries the logic.

## 6. Verification & process

- TDD `pageParam`/`pageSizeParam` (red → green). `pnpm typecheck` (separate); full unit suite serial; `pnpm exec eslint <changed files>`.
- **Inline execution** (small, tightly coupled — 5 files + 1 test; no subagent fan-out warranted).
- Reviews on the diff: `pr-reviewer` (always) + **`audit-tenancy`** (mandatory — the diff touches `src/app/api/portal/*`; prove scoping/isolation is untouched) + `audit-api-contract` (touches `src/app/api`; confirm the JSON contract + envelope are unchanged).
- No browser/screenshot pass (no visual surface). PLAYBOOK §6 self-audit printed. Owner go before commit; second go before push (per-action).

## 7. Tier

Tier B (input-validation hardening + behavior-preserving refactor; no schema/migration/auth/pipeline surface, no scope-logic change). No ADR (a shared Zod boundary primitive; new `src/lib/query-params.ts` is a small util consistent with `src/lib/http.ts`).

## WP candidates surfaced (do not build here)

- **`listPartnerActivity` pagination redesign** — replace `.limit(page*PAGE_SIZE)` + in-memory merge with a DB-side merge / keyset (or a bounded window independent of `page`). The root fix for the smell E only caps.
- App-wide huge-offset hardening (admin `LIMIT/OFFSET` deep pages) — separate, lower priority; admin is trusted-internal.
