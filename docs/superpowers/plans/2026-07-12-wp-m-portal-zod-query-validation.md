# WP-M — Portal Zod query validation + shared page primitive — Implementation Plan

> **For agentic workers:** execute inline (superpowers:executing-plans). Small, tightly coupled. Steps use `- [ ]`.

**Goal:** One canonical `pageParam`/`pageSizeParam` Zod primitive; the two portal `?page` GET routes validate at the boundary (with a defensive cap); the two admin schemas reuse the primitive (behavior-identical).

**Architecture:** New pure `src/lib/query-params.ts`. Portal routes parse `?page` with `pageParam({ max: PORTAL_MAX_PAGE })`. Admin `leads`/`activity` schemas swap their duplicated inline `page`/`pageSize` transforms for the shared factory.

**Tech Stack:** Next.js route handlers, Zod, vitest (serial).

**Spec:** `docs/superpowers/specs/2026-07-12-wp-m-portal-zod-query-validation-design.md`

## Global Constraints
- **Behavior-preserving for admin** — `pageParam()`/`pageSizeParam()` must produce byte-identical results to the current inline transforms (coerce→floor→≥1 else 1; pageSize whitelisted {10,20,50} default 20). Admin stays **uncapped**.
- Portal cap `PORTAL_MAX_PAGE = 1000` applies **only** to portal.
- No changes to any query, scope guard, ToS gate, error envelope, or JSON response shape.
- vitest serial: `pnpm exec vitest run <file> --no-file-parallelism`; full suite `pnpm test:unit -- --no-file-parallelism`. `pnpm typecheck` separately. Lint changed files only.
- Test names carry the closest requirement ID (FEP-03 / PTL-02 / ACT-02). No commits until Task 4, gated on explicit owner "go".

---

### Task 1: TDD the shared primitive (`src/lib/query-params.ts`)

**Files:** Create `src/lib/query-params.ts`, Create `tests/unit/query-params.test.ts`

- [ ] **Step 1: Write the failing test** `tests/unit/query-params.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { pageParam, pageSizeParam, PORTAL_MAX_PAGE } from "@/lib/query-params";

describe("query-params primitives", () => {
  it("FEP-03: pageParam coerces to a floored int >= 1, else 1", () => {
    const p = pageParam();
    expect(p.parse("1")).toBe(1);
    expect(p.parse("3")).toBe(3);
    expect(p.parse("2.9")).toBe(2);
    expect(p.parse(null)).toBe(1);
    expect(p.parse(undefined)).toBe(1);
    expect(p.parse("0")).toBe(1);
    expect(p.parse("-5")).toBe(1);
    expect(p.parse("abc")).toBe(1);
  });

  it("PTL-02: pageParam clamps to max when given (portal ceiling)", () => {
    const p = pageParam({ max: PORTAL_MAX_PAGE });
    expect(p.parse("5")).toBe(5);
    expect(p.parse(String(PORTAL_MAX_PAGE))).toBe(PORTAL_MAX_PAGE);
    expect(p.parse(String(PORTAL_MAX_PAGE + 1))).toBe(PORTAL_MAX_PAGE);
    expect(p.parse("999999999")).toBe(PORTAL_MAX_PAGE);
    expect(p.parse("abc")).toBe(1);
  });

  it("ACT-02: pageSizeParam whitelists {10,20,50}, default 20", () => {
    const s = pageSizeParam();
    expect(s.parse("10")).toBe(10);
    expect(s.parse("50")).toBe(50);
    expect(s.parse("20")).toBe(20);
    expect(s.parse("37")).toBe(20);
    expect(s.parse(null)).toBe(20);
    expect(s.parse(undefined)).toBe(20);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)
Run: `pnpm exec vitest run tests/unit/query-params.test.ts --no-file-parallelism` → FAIL.

- [ ] **Step 3: Implement** `src/lib/query-params.ts`

```ts
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Shared API query-param primitives (validated at the boundary — API standards).
// One canonical definition consumed by admin schemas and portal routes alike.
// ─────────────────────────────────────────────────────────────────────────────

/** Page number: coerce → floor → >=1 else 1, optionally clamped to `max`.
 *  Graceful (never 400), matching "invalid filters degrade to defaults".
 *  `.parse(searchParams.get("page"))` handles string | null; missing → 1. */
export function pageParam(opts?: { max?: number }) {
  return z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    let p = Number.isFinite(n) && n >= 1 ? n : 1;
    if (opts?.max != null && p > opts.max) p = opts.max;
    return p;
  });
}

/** Rows per page — whitelisted to {10,20,50}, default 20 (mirrors Pagination.PAGE_SIZES). */
export function pageSizeParam() {
  return z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    return n === 10 || n === 50 ? n : 20;
  });
}

/** Portal list ceiling — a partner's data is inherently bounded, so this never
 *  affects legitimate paging; it bounds pathological `?page=<huge>` (esp. the
 *  listPartnerActivity in-memory window). Admin stays uncapped. */
export const PORTAL_MAX_PAGE = 1000;
```

- [ ] **Step 4: Run — expect PASS.** Then `pnpm typecheck`.

---

### Task 2: Wire the two portal routes

**Files:** Modify `src/app/api/portal/leads/route.ts`, `src/app/api/portal/activity/route.ts`

- [ ] **Step 1: `leads/route.ts`** — add import, replace the ad-hoc parse.

Add to imports: `import { pageParam, PORTAL_MAX_PAGE } from "@/lib/query-params";`
Replace:
```ts
    const raw = Number(new URL(request.url).searchParams.get("page") ?? "1");
    const page = Number.isFinite(raw) && raw > 0 ? raw : 1;
    return jsonOk(await listPartnerLeads(scope, page));
```
with:
```ts
    const page = pageParam({ max: PORTAL_MAX_PAGE }).parse(new URL(request.url).searchParams.get("page"));
    return jsonOk(await listPartnerLeads(scope, page));
```

- [ ] **Step 2: `activity/route.ts`** — add import, replace the parse.

Add to imports: `import { pageParam, PORTAL_MAX_PAGE } from "@/lib/query-params";`
Replace:
```ts
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    return jsonOk(await listPartnerActivity(scope, page));
```
with:
```ts
    const page = pageParam({ max: PORTAL_MAX_PAGE }).parse(new URL(request.url).searchParams.get("page"));
    return jsonOk(await listPartnerActivity(scope, page));
```

- [ ] **Step 3:** `pnpm typecheck` — clean.

---

### Task 3: DRY the admin schemas (behavior-identical)

**Files:** Modify `src/modules/leads/schema.ts`, `src/modules/activity/schema.ts`

- [ ] **Step 1: `leads/schema.ts`** — import the primitives; replace the inline `page`/`pageSize` fields.

Add: `import { pageParam, pageSizeParam } from "@/lib/query-params";`
Replace the two fields (lines ~24-32):
```ts
  page: z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }),
  /** Rows per page — whitelisted to {10,20,50} (mirrors Pagination.PAGE_SIZES), default 20. */
  pageSize: z.unknown().optional().transform((v) => {
    const n = Math.floor(Number(v));
    return n === 10 || n === 50 ? n : 20;
  }),
```
with:
```ts
  page: pageParam(),
  pageSize: pageSizeParam(),
```

- [ ] **Step 2: `activity/schema.ts`** — same replacement (lines ~14-22).

Add: `import { pageParam, pageSizeParam } from "@/lib/query-params";`
Replace the `page` and `pageSize` fields with `page: pageParam(),` / `pageSize: pageSizeParam(),` (identical to Step 1).

- [ ] **Step 3:** `pnpm typecheck` — clean. Then run any existing schema/query tests + the full unit suite serial to confirm admin behavior is unchanged.

Run: `pnpm test:unit -- --no-file-parallelism` → all green (incl. the new `query-params.test.ts`).

---

### Task 4: Verify, review, gated commit

- [ ] **Step 1:** Full unit suite serial (done in Task 3) green; `pnpm typecheck` clean; `pnpm exec eslint <changed files>` clean.
- [ ] **Step 2: PLAYBOOK §6 self-audit** — fill + print. Confirm PRN-08 (no scope change — the guards/`getServerScope` are untouched; only input parsing changed), no query/contract change, requirement-ID test names, Tier B.
- [ ] **Step 3: Reviews on the diff** — dispatch in parallel: `pr-reviewer` (always), `audit-tenancy` (mandatory — diff touches `src/app/api/portal/*`; prove no scope/isolation change), `audit-api-contract` (confirm JSON contract + envelope unchanged; admin behavior identical). Address findings (verify each against real code first).
- [ ] **Step 4: Owner walkthrough → gated single commit.** On explicit "go":

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(wp-m): portal GET-route Zod page validation + shared query primitive

New src/lib/query-params.ts (pageParam/pageSizeParam); portal leads+activity
routes validate ?page via pageParam({max: PORTAL_MAX_PAGE}) (defensive ceiling
on the listPartnerActivity in-memory window); admin leads/activity schemas
reuse the shared primitive (behavior-identical). Boundary validation per the
"Zod-validate every input" rule; removes 4 duplicated/ad-hoc page parses.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```
Do NOT push; await a second explicit "go".

---

## Self-Review (against the spec)
**Coverage:** §3 primitive → Task 1. §3 portal wiring → Task 2. §3 admin DRY → Task 3. §5 tests → Task 1 (TDD). §6 verification/reviews/commit → Task 4. §4 non-goals honored (no query/redesign). §7 Tier B / no ADR → Task 4.
**Placeholders:** none — every step has exact old→new code.
**Consistency:** `pageParam`/`pageSizeParam`/`PORTAL_MAX_PAGE` names identical across the primitive, tests, portal routes, and admin schemas. The admin replacement code matches the current inline transforms 1:1 (verified against `leads/schema.ts:24-32`, `activity/schema.ts:14-22`).
