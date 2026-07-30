# WP-SU-8 / WP-SU-9 / WP-SU-10 + production-like deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three remaining signup/observability gaps from the WP-SU-2…7 review gates — a global signup ceiling with a surge alert, an atomic (non-TOCTOU) throttle decision plus the missing `reset/confirm` throttle, and `onRequestError` wiring so App Router route-handler errors reach Sentry — then stand up a production-like deployment.

**Architecture:** All three WPs sit on infrastructure that already exists. WP-SU-8 adds a third, *global* dimension to the existing `auth_attempts` counter table (kind-scoped, no new table) plus a pure surge verdict and a per-recipient mail cap. WP-SU-9 inverts the order of the existing snapshot/record pair into `reserve → snapshot → decide → settle`, which makes the rate-window decision fail-closed under concurrency without locks, transactions, or a schema change; the same task wires the last unthrottled credential endpoint. WP-SU-10 exports a second hook from `src/instrumentation.ts` and extends the existing `beforeSend` scrubber to cover the one new PII path that hook introduces.

**Tech Stack:** Next.js 16.2 (App Router), TypeScript, Drizzle ORM + Postgres (Supabase), Zod, Vitest (serial), `@sentry/nextjs` 10.65, Resend, Cloudflare Turnstile.

## Global Constraints

Every task's requirements implicitly include this section.

- **Tier A cadence.** Auth + deploy. Per WP: plan → owner sign-off → TDD → gate → reviews → fold findings → **owner's explicit go before commit AND a separate go before push**. Implementers **STAGE ONLY** (`git add <their files>`, never `-A`, never commit).
- **NEVER stage:** `PRODUCT_BRIEF.md`, `WEBSITE-BRIEF.md`, `docs/legal/`. Check `git diff --cached --name-only` before every commit.
- `SIGNUP_ENABLED` stays **OFF**. Do not flip it.
- **AUT-05:** auth endpoints return uniform messages *and* timing whether or not the account exists. A new refusal path on signup must reuse the existing `UNIFORM` body.
- **AUT-09:** all secret comparisons use `timingSafeEqual`, never `===`.
- **SEC-05:** never log passwords, tokens, OTPs, or seller/user email. Alert codes and counts only.
- **SEC-07:** non-production email goes to the sink; code must never be able to email real partners from dev/preview.
- **PRN-08:** every API-route query goes through `lib/scope.ts`; documented exemptions only (`emailExistsGlobally` is the existing precedent).
- Zod-validate every API input; uniform error envelope `{code,message,traceId}`.
- Schema change ⇒ migration + seed + RLS policy + index **in the same PR**. `auth_attempts` already has deny-by-default RLS (migration 0004) and is a token/counter table with no seed — an index-only migration needs neither, and the task says so explicitly.
- Test names carry requirement IDs: `it("AUT-03: ...")`.
- **Vitest is serial:** `pnpm vitest run --no-file-parallelism`. Integration tests **self-skip silently** without `DATABASE_URL` — read the counts, never the word "skipped".
- Migrations via `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs generate` then `migrate`. **Inspect the generated SQL before applying.**
- **Next free ADR = 0035. Next free migration = 0027** (this plan uses exactly one: 0027).
- No new npm dependency without an ADR. None of these three WPs needs one.
- Prefer boring code.

### Carried lessons from the WP-SU-2…7 run (these cost rework — do not repeat)

1. **Mocked tests hide SDK reality.** Unit tests mock `@sentry/nextjs` wholesale. Always run the real `pnpm build` (both runtimes) *and* one unmocked probe before believing an SDK-integration change. This bit WP-SU-3 twice.
2. **Reading source isn't enough — ask what it means for our payloads.** (Task 10 exists because of exactly this: `captureRequestError` writes `request_path` into a Sentry *context* that the current `beforeSend` does not touch.)
3. **A test that passes immediately proves nothing.** Task 5's concurrency test must be run against the *old* code first and observed to fail.
4. **Restating a rule in two places drifts immediately.** Derive, don't duplicate.
5. **Verify review findings — and their refutations — against real code before acting.**

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/lib/auth/signup-surge.ts` | Pure verdict: given the prior hour's global signup count, decide block / alert / neither. No I/O. |
| `src/lib/auth/already-registered-cap.ts` | Per-recipient cap on the victim-directed "already registered" mail. One exported async guard. |
| `src/db/migrations/0027_*.sql` | Index only: `auth_attempts (kind, created_at)` — backs the global count. |
| `tests/unit/signup-surge.test.ts` | Pure-function table tests for the verdict. |
| `tests/unit/instrumentation-request-error.test.ts` | `onRequestError` delegation, inertness, never-throws, and the `request_path` scrub. |
| `tests/integration/auth-attempts-global.test.ts` | `kindCount` against the real DB. |
| `tests/integration/throttle-atomicity.test.ts` | The TOCTOU proof: N concurrent decisions, at most `limit` pass. |
| `tests/integration/reset-confirm-throttle.test.ts` | The new `reset/confirm` throttle. |

**Modified:**

| File | Change |
|---|---|
| `src/lib/auth/attempts-store.ts` | `+kindCount` (SU-8); `record` → `reserve`/`settle` pair (SU-9). |
| `src/lib/auth/throttle.ts` | `+SIGNUP_GLOBAL_CEILING`, `+SIGNUP_SURGE_THRESHOLD`, `+ALREADY_REGISTERED_CAP`, `+RESET_CONFIRM_THROTTLE`. |
| `src/db/schema.ts` | One index on `authAttempts`. |
| `src/app/api/auth/signup/route.ts` | Global ceiling + surge alert + capped notice mail (SU-8); reserve/settle (SU-9). |
| `src/app/api/auth/login/route.ts`, `otp/request`, `otp/verify`, `reset/request`, `signup/verify` | reserve/settle (SU-9). |
| `src/app/api/auth/reset/confirm/route.ts` | New throttle (SU-9). |
| `src/instrumentation.ts` | `+onRequestError`; `beforeSend` also strips the query from `contexts.nextjs.request_path` (SU-10). |
| `docs/adr/0032-*.md` | Alert-code list += new codes; residual note narrowed (SU-10). |
| `docs/adr/0034-*.md` | Record the global ceiling + its availability trade-off. |
| `docs/SPEC.md` | AUT-03 throttled-endpoint list += `reset/confirm`. |
| `docs/GO-LIVE-CHECKLIST.md` | Refresh (Part 4). |
| `.env.example` | Nothing new — no new env var in any of these three WPs. |

---

# WP-SU-8 — Global signup ceiling + surge alert + per-recipient mail cap

> **AS-BUILT DEVIATIONS (2026-07-30, after the review gate).** Two changes from the plan below,
> both driven by a defect found during implementation:
>
> 1. **The equality-based alert scheme in Task 2 was wrong and was replaced.** `>= `-based
>    verdict + an explicit `SIGNUP_ALERT_COOLDOWN` (1/hour, keyed per threshold). A
>    ceiling-refused request returns 429 before the route records an attempt, so refusals never
>    increment the count: the count froze at exactly the ceiling and the equality branch
>    re-fired on every subsequent refused request. Measured: 3 refused requests → 3 alerts.
>    Independently re-derived by pr-reviewer (F-1, High). The cooldown is keyed per threshold on
>    pr-reviewer's recommendation, so a surge alert cannot swallow the ceiling alert.
> 2. **`src/lib/auth/already-registered-cap.ts` became `src/lib/auth/notice-budget.ts`**, now
>    holding one shared `consumeBudget` primitive behind two named guards
>    (`allowAlreadyRegisteredMail`, `allowSignupAlert`) — the alert cooldown needed the same
>    read-then-write budget, and two near-identical helpers is the drift this repo has been
>    bitten by before (carried lesson 4).
>
> Also added from the gate: a regression test asserting the alert COUNT rather than its presence
> (pr-reviewer F-2), a non-CONCURRENTLY rationale comment in migration 0027 (audit-data F-3), an
> ADR-0010 note that the largest `auth_attempts` window is now 24h (audit-data F-2), and
> documented CWE-367 residuals on both the ceiling and the notice cap (audit-data F-1,
> pr-reviewer F-3/F-4).

**Why:** both existing signup throttle keys are attacker-chosen. A fresh email defeats the per-identifier limit (5/15min); a rotated IP defeats the per-IP limit (20/15min). What actually bounds distributed signup abuse today is Turnstile alone. And unlike login, signup has no anomaly alert at all — a surge is currently invisible.

**Design decisions baked in (flag at walkthrough if you disagree):**

- **Ceiling = 60 signups/hour globally**, alert at **30/hour**. Real volume is expected in the single digits per *day*, so 60 is ~100× headroom while still capping a distributed burst at 60 provisioning runs + 60 emails per hour.
- **The ceiling is deliberately a small availability lever:** an attacker who burns 60/hour blocks legitimate signups. That is inherent to *any* global ceiling and is why the alert fires at half the ceiling. Accepted because (a) `SIGNUP_ENABLED` is off, (b) signup is not a revenue path yet, (c) the alternative — unbounded provisioning — is worse. Recorded in ADR-0034.
- **Retry-After on a ceiling refusal is a flat 300s.** A count-only check cannot compute an exact drain time, and fetching the oldest timestamp to compute one would leak global volume through the header.
- **The refusal reuses the existing `UNIFORM` body and 429** — byte-identical to the per-identifier refusal, so it adds no enumeration signal (AUT-05).
- **The already-registered cap is 3 per recipient per 24h**, counted in `auth_attempts` under a synthetic kind `signup_notice`, recorded with `success: true` so it can never feed the AUT-04 lockout ladder.

---

### Task 1: Global attempt count + its index

**Files:**
- Modify: `src/db/schema.ts:560-563` (the `authAttempts` index list)
- Create: `src/db/migrations/0027_*.sql` (generated)
- Modify: `src/lib/auth/attempts-store.ts:64-72` (add after `ipFailureCount`)
- Test: `tests/integration/auth-attempts-global.test.ts`

**Interfaces:**
- Consumes: `AuthAttemptsStore` (existing), `schema.authAttempts` (existing).
- Produces: `AuthAttemptsStore.kindCount(kind: string, now: number, windowMs: number): Promise<number>` — total rows of that kind newer than `now - windowMs`, across **all** identifiers and IPs.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/auth-attempts-global.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";

// WP-SU-8: the per-identifier and per-IP windows are both keyed on attacker-chosen
// values. The global count is the one dimension an attacker cannot rotate away from.
// Self-skips without DATABASE_URL (must NOT self-skip in this environment).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("AuthAttemptsStore.kindCount (WP-SU-8)", () => {
  const db = getDb();
  const store = new AuthAttemptsStore(db);
  // A unique kind per run keeps this test independent of every other suite's rows.
  const KIND = `test_signup_${randomUUID().slice(0, 8)}`;
  const OTHER = `${KIND}_other`;

  afterAll(async () => {
    await db.delete(schema.authAttempts).where(inArray(schema.authAttempts.kind, [KIND, OTHER]));
  });

  it("AUT-03: counts every identifier and IP under one kind", async () => {
    await store.record("a@example.test", "203.0.113.1", KIND, false);
    await store.record("b@example.test", "203.0.113.2", KIND, false);
    await store.record("c@example.test", null, KIND, false);
    expect(await store.kindCount(KIND, Date.now(), 3_600_000)).toBe(3);
  });

  it("AUT-03: does not count another kind", async () => {
    await store.record("d@example.test", "203.0.113.3", OTHER, false);
    expect(await store.kindCount(KIND, Date.now(), 3_600_000)).toBe(3);
  });

  it("AUT-03: excludes rows older than the window", async () => {
    const old = new Date(Date.now() - 7_200_000);
    await db.insert(schema.authAttempts).values({
      identifier: "old@example.test", ip: null, kind: KIND, success: false, createdAt: old,
    });
    expect(await store.kindCount(KIND, Date.now(), 3_600_000)).toBe(3);
    expect(await store.kindCount(KIND, Date.now(), 10_800_000)).toBe(4);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

```bash
pnpm vitest run --no-file-parallelism tests/integration/auth-attempts-global.test.ts
```

Expected: FAIL — `store.kindCount is not a function`. **If it reports 0 tests or "skipped", `DATABASE_URL` is missing — stop and fix the environment before continuing** (a new worktree without `.env.local` self-skips and looks green).

- [ ] **Step 3: Add the index to the schema**

In `src/db/schema.ts`, the `authAttempts` index list becomes:

```ts
  (t) => [
    index("auth_attempts_identifier_idx").on(t.identifier, t.kind, t.createdAt),
    index("auth_attempts_ip_idx").on(t.ip, t.kind, t.createdAt),
    // WP-SU-8: backs the GLOBAL rolling-hour ceiling. Neither index above can serve it —
    // both lead with an attacker-chosen column, which is precisely why a global dimension
    // was needed. Leading with `kind` keeps the scan to one endpoint's rows.
    index("auth_attempts_kind_created_idx").on(t.kind, t.createdAt),
  ],
```

- [ ] **Step 4: Generate and inspect the migration**

```bash
node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs generate
```

Open the generated `src/db/migrations/0027_*.sql`. It must contain **exactly one** statement:

```sql
CREATE INDEX "auth_attempts_kind_created_idx" ON "auth_attempts" USING btree ("kind","created_at");
```

If it contains anything else — a DROP, a table change, an unrelated diff — **stop and report**; the schema file has drifted from the DB. No RLS policy or seed accompanies this migration: `auth_attempts` is already deny-by-default RLS from migration 0004 and is a counter table with no seed rows. Note that in the walkthrough so the "schema change = migration + seed + RLS + index" rule is visibly satisfied rather than silently skipped.

- [ ] **Step 5: Apply it**

```bash
node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate
```

- [ ] **Step 6: Implement `kindCount`**

In `src/lib/auth/attempts-store.ts`, after `ipFailureCount`:

```ts
  /**
   * WP-SU-8: total attempts of one kind across ALL identifiers and IPs in a window.
   * The per-identifier and per-IP windows are both keyed on values an attacker picks
   * freely (a fresh email, a rotated IP), so this is the only dimension that bounds a
   * distributed burst. Backed by auth_attempts_kind_created_idx (migration 0027).
   */
  async kindCount(kind: string, now: number, windowMs: number): Promise<number> {
    const A = schema.authAttempts;
    const [row] = await this.db
      .select({ c: sql<number>`count(*)::int` })
      .from(A)
      .where(and(eq(A.kind, kind), gt(A.createdAt, new Date(now - windowMs))));
    return row?.c ?? 0;
  }
```

(`and`, `eq`, `gt`, `sql` are already imported at the top of the file.)

- [ ] **Step 7: Run the test and verify it passes**

```bash
pnpm vitest run --no-file-parallelism tests/integration/auth-attempts-global.test.ts
```

Expected: 3 passed, 0 skipped.

- [ ] **Step 8: Confirm the index is actually used**

```bash
node --env-file=.env.local -e "const p=require('postgres');const s=p(process.env.DATABASE_URL);s\`explain select count(*) from auth_attempts where kind='signup' and created_at > now() - interval '1 hour'\`.then(r=>{console.log(r.map(x=>x['QUERY PLAN']).join('\n'));return s.end()})"
```

Expected: an `Index Only Scan`/`Bitmap Index Scan` naming `auth_attempts_kind_created_idx`. A `Seq Scan` on a nearly-empty dev table is acceptable (the planner prefers it below a few hundred rows) — record which you saw in the report; do not "fix" a Seq Scan on an empty table.

- [ ] **Step 9: Stage**

```bash
git add src/db/schema.ts src/db/migrations src/lib/auth/attempts-store.ts tests/integration/auth-attempts-global.test.ts
git diff --cached --name-only
```

The name list must contain only those paths. **Do not commit.**

---

### Task 2: The pure surge verdict

**Files:**
- Create: `src/lib/auth/signup-surge.ts`
- Modify: `src/lib/auth/throttle.ts` (append constants)
- Test: `tests/unit/signup-surge.test.ts`

**Interfaces:**
- Consumes: `RateRule` from `@/lib/auth/rate-limit` (existing: `{ limit: number; windowMs: number }`).
- Produces:
  - `SIGNUP_GLOBAL_CEILING: RateRule`, `SIGNUP_SURGE_THRESHOLD: number`, `SIGNUP_CEILING_RETRY_SEC: number`, `ALREADY_REGISTERED_CAP: RateRule` (all from `@/lib/auth/throttle`).
  - `evaluateSignupSurge(priorCount: number, ceiling: RateRule, surgeThreshold: number): SurgeVerdict` where `SurgeVerdict = { blocked: boolean; alert: string | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/signup-surge.test.ts
import { describe, it, expect } from "vitest";
import { evaluateSignupSurge } from "@/lib/auth/signup-surge";
import { SIGNUP_GLOBAL_CEILING, SIGNUP_SURGE_THRESHOLD } from "@/lib/auth/throttle";

const verdict = (prior: number) => evaluateSignupSurge(prior, SIGNUP_GLOBAL_CEILING, SIGNUP_SURGE_THRESHOLD);

describe("AUT-03 (WP-SU-8): global signup surge verdict", () => {
  it("AUT-03: allows a normal request with no alert", () => {
    expect(verdict(0)).toEqual({ blocked: false, alert: null });
    expect(verdict(5)).toEqual({ blocked: false, alert: null });
  });

  it("AUT-03: alerts exactly once, on the request that crosses the surge threshold", () => {
    expect(verdict(SIGNUP_SURGE_THRESHOLD - 1).alert).toBeNull();
    expect(verdict(SIGNUP_SURGE_THRESHOLD)).toEqual({
      blocked: false,
      alert: `signup surge: ${SIGNUP_SURGE_THRESHOLD} in the last hour (ceiling ${SIGNUP_GLOBAL_CEILING.limit})`,
    });
    // One past the threshold must NOT re-alert — equality, not >=, is what makes it fire once.
    expect(verdict(SIGNUP_SURGE_THRESHOLD + 1).alert).toBeNull();
  });

  it("AUT-03: blocks at the ceiling and alerts exactly once as it starts refusing", () => {
    expect(verdict(SIGNUP_GLOBAL_CEILING.limit - 1).blocked).toBe(false);
    expect(verdict(SIGNUP_GLOBAL_CEILING.limit)).toEqual({
      blocked: true,
      alert: `signup ceiling reached: ${SIGNUP_GLOBAL_CEILING.limit} in the last hour — new signups are being refused`,
    });
    expect(verdict(SIGNUP_GLOBAL_CEILING.limit + 9)).toEqual({ blocked: true, alert: null });
  });

  it("AUT-03: the alert string carries no identifier, email or IP (SEC-05)", () => {
    const alerts = [verdict(SIGNUP_SURGE_THRESHOLD).alert, verdict(SIGNUP_GLOBAL_CEILING.limit).alert];
    for (const a of alerts) expect(a).not.toMatch(/@|\d+\.\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

```bash
pnpm vitest run --no-file-parallelism tests/unit/signup-surge.test.ts
```

Expected: FAIL — cannot resolve `@/lib/auth/signup-surge`.

- [ ] **Step 3: Add the constants**

Append to `src/lib/auth/throttle.ts`:

```ts
// WP-SU-8: a GLOBAL rolling-hour ceiling across every identifier and IP. Both keys above
// are attacker-chosen — a fresh email defeats perIdentifier, a rotated IP defeats perIp —
// so without this, distributed signup abuse is bounded by Turnstile alone.
//
// TRADE-OFF, deliberate (ADR-0034): a global ceiling is by construction a small
// availability lever — an attacker who burns the hour's budget also refuses honest
// signups. Every global ceiling has this shape. It is accepted here because the limit sits
// ~100x above expected volume (single digits per DAY), the alert fires at half of it, and
// the alternative is unbounded tenant provisioning + outbound mail.
export const SIGNUP_GLOBAL_CEILING: RateRule = { limit: 60, windowMs: 3_600_000 };

/** Alert at half the ceiling, so a surge is visible well before signups start failing. */
export const SIGNUP_SURGE_THRESHOLD = 30;

/**
 * Retry-After for a ceiling refusal. Flat, not computed: a count-only check has no
 * timestamps to drain-time from, and fetching the oldest one to compute an exact value
 * would leak global signup volume through a response header.
 */
export const SIGNUP_CEILING_RETRY_SEC = 300;

/**
 * WP-SU-8: per-recipient cap on the victim-directed "you already have an account" mail.
 * Without it, the per-identifier signup limit (5/15min) lets an attacker mail-bomb a known
 * address ~480x/day using the victim's own address as the key.
 */
export const ALREADY_REGISTERED_CAP: RateRule = { limit: 3, windowMs: 86_400_000 }; // 3 / 24h
```

`RateRule` is already imported at the top of `throttle.ts` (`import { rateDecision, type RateRule } from "./rate-limit";`).

- [ ] **Step 4: Implement the verdict**

```ts
// src/lib/auth/signup-surge.ts
import type { RateRule } from "./rate-limit";

// WP-SU-8: the GLOBAL signup dimension, kept pure so it is deterministic and unit-tested —
// the store supplies the count, this decides. Mirrors the rate-limit/throttle split.
//
// Both alerts fire on EQUALITY, not >=, so each crossing produces exactly one email
// instead of one per request for the rest of the hour. This is the same trick the login
// anomaly alert uses (`ipFails === ANOMALY_THRESHOLD`, login/route.ts). The cost is that a
// crossing can be missed if two requests race past the same count; a missed alert is the
// right failure here, an inbox flood is not.

export interface SurgeVerdict {
  /** Refuse this request — the global hourly ceiling is reached. */
  blocked: boolean;
  /** Non-null only when THIS request is the one that crosses a threshold. */
  alert: string | null;
}

/**
 * @param priorCount signup attempts in the trailing window, NOT counting this request.
 */
export function evaluateSignupSurge(
  priorCount: number,
  ceiling: RateRule,
  surgeThreshold: number,
): SurgeVerdict {
  if (priorCount === ceiling.limit) {
    return {
      blocked: true,
      alert: `signup ceiling reached: ${ceiling.limit} in the last hour — new signups are being refused`,
    };
  }
  if (priorCount > ceiling.limit) return { blocked: true, alert: null };
  if (priorCount === surgeThreshold) {
    return {
      blocked: false,
      alert: `signup surge: ${surgeThreshold} in the last hour (ceiling ${ceiling.limit})`,
    };
  }
  return { blocked: false, alert: null };
}
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
pnpm vitest run --no-file-parallelism tests/unit/signup-surge.test.ts
```

Expected: 4 passed.

- [ ] **Step 6: Stage**

```bash
git add src/lib/auth/signup-surge.ts src/lib/auth/throttle.ts tests/unit/signup-surge.test.ts
git diff --cached --name-only
```

**Do not commit.**

---

### Task 3: Wire the ceiling and the alert into the signup route

**Files:**
- Modify: `src/app/api/auth/signup/route.ts:60-74`
- Test: `tests/integration/signup-route.test.ts` (extend the existing suite)

**Interfaces:**
- Consumes: `kindCount` (Task 1), `evaluateSignupSurge` + constants (Task 2), `notifyAuthAnomaly` from `@/lib/auth/notify` (existing: `(detail: string) => Promise<void>`, best-effort, never throws, no-ops when `ADMIN_ALLOWLIST` is empty).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `suite("POST /api/auth/signup", ...)` block in `tests/integration/signup-route.test.ts`. The suite already mocks `next/server`'s `after` into `afterCallbacks` with a `flushAfter()` helper, mocks `verifyTurnstile`, and mocks `getSupabaseAdmin` — reuse all of that. Add at the top of the file, with the other `vi.mock` calls:

```ts
// WP-SU-8: capture the surge alert without sending mail. notifyAuthAnomaly is best-effort
// and self-logging in production; here we only need to know whether it fired and with what.
const anomalyCalls: string[] = [];
vi.mock("@/lib/auth/notify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/notify")>();
  return { ...actual, notifyAuthAnomaly: async (d: string) => { anomalyCalls.push(d); } };
});
```

Then the tests:

```ts
  // WP-SU-8: seed the global window directly. Going through the route would trip the
  // per-identifier limit long before the global ceiling, which is the whole point of the
  // global dimension — it is the only one an attacker cannot rotate away from.
  async function seedGlobalSignups(count: number) {
    const rows = Array.from({ length: count }, (_, i) => ({
      identifier: `surge-${i}-${randomUUID()}@example.test`,
      ip: `198.51.100.${i % 250}`,
      kind: "signup",
      success: true,
      createdAt: new Date(Date.now() - 60_000),
    }));
    for (const r of rows) identifiersToClear.push(r.identifier);
    await db.insert(schema.authAttempts).values(rows);
  }

  it("AUT-03 (WP-SU-8): refuses past the global hourly ceiling, with the UNIFORM body", async () => {
    await seedGlobalSignups(SIGNUP_GLOBAL_CEILING.limit);
    const res = await POST(jsonRequest("http://localhost:3000/api/auth/signup", {
      email: `fresh-${randomUUID()}@example.test`,
      password: strongPassword(),
      workspaceName: "Surge Co",
      captchaToken: "t",
      tosAccepted: true,
    }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(SIGNUP_CEILING_RETRY_SEC));
    // AUT-05: byte-identical to the per-identifier refusal — the ceiling adds no signal.
    expect(await res.json()).toEqual({
      code: "signup_check_email",
      message: "If that email can be used, we've sent a link to finish signing up.",
    });
    await flushAfter();
    expect(anomalyCalls.some((d) => d.includes("ceiling reached"))).toBe(true);
    // AUT-03: refused before any provisioning — no auth user was created.
    expect(createUserCalls).toHaveLength(0);
  });

  it("AUT-03 (WP-SU-8): alerts on the surge threshold WITHOUT refusing the request", async () => {
    await seedGlobalSignups(SIGNUP_SURGE_THRESHOLD);
    const res = await POST(jsonRequest("http://localhost:3000/api/auth/signup", {
      email: `fresh-${randomUUID()}@example.test`,
      password: strongPassword(),
      workspaceName: "Surge Co",
      captchaToken: "t",
      tosAccepted: true,
    }));
    expect(res.status).toBe(200);
    await flushAfter();
    expect(anomalyCalls.some((d) => d.includes("signup surge"))).toBe(true);
  });

  it("SEC-05 (WP-SU-8): the surge alert carries no email address", async () => {
    await seedGlobalSignups(SIGNUP_SURGE_THRESHOLD);
    const email = `victim-${randomUUID()}@example.test`;
    await POST(jsonRequest("http://localhost:3000/api/auth/signup", {
      email, password: strongPassword(), workspaceName: "Surge Co", captchaToken: "t", tosAccepted: true,
    }));
    await flushAfter();
    expect(anomalyCalls.join(" ")).not.toContain(email);
  });
```

Add to the file's imports:

```ts
import { SIGNUP_GLOBAL_CEILING, SIGNUP_SURGE_THRESHOLD, SIGNUP_CEILING_RETRY_SEC } from "@/lib/auth/throttle";
```

and reset `anomalyCalls.length = 0` in the existing `beforeEach`. Ensure `identifiersToClear` (already in the suite) is drained in the existing cleanup so seeded rows cannot leak into the next suite — the global count is genuinely global, so stray `kind: "signup"` rows will poison *other* tests. If the existing cleanup deletes by identifier, this is already handled; verify it, and if not, delete by `inArray(schema.authAttempts.identifier, identifiersToClear)` in `afterAll`.

- [ ] **Step 2: Run and verify they fail**

```bash
pnpm vitest run --no-file-parallelism tests/integration/signup-route.test.ts
```

Expected: the three new tests FAIL (200 instead of 429; no anomaly calls). The pre-existing tests must still pass — if any of them break, the seeding is leaking; fix the cleanup before continuing.

- [ ] **Step 3: Implement**

In `src/app/api/auth/signup/route.ts`, add to the imports:

```ts
import { evaluateThrottle, SIGNUP_THROTTLE, SIGNUP_GLOBAL_CEILING, SIGNUP_SURGE_THRESHOLD, SIGNUP_CEILING_RETRY_SEC } from "@/lib/auth/throttle";
import { evaluateSignupSurge } from "@/lib/auth/signup-surge";
import { notifySignupVerify, notifyAlreadyRegistered, notifyAuthAnomaly } from "@/lib/auth/notify";
```

Then, immediately after the existing per-identifier/per-IP throttle block (after the `if (!throttle.ok)` return, before the Turnstile check), insert:

```ts
  // WP-SU-8: the GLOBAL ceiling. Both keys checked above are attacker-chosen, so this is
  // the only limit a distributed burst cannot rotate around. Checked BEFORE the CAPTCHA
  // and password work so a burst costs us one indexed count, not a Cloudflare round-trip
  // and an HIBP lookup each.
  const priorHour = await attempts.kindCount(KIND, now, SIGNUP_GLOBAL_CEILING.windowMs);
  const surge = evaluateSignupSurge(priorHour, SIGNUP_GLOBAL_CEILING, SIGNUP_SURGE_THRESHOLD);
  if (surge.alert) {
    // Deferred: alerting must never be on the measured wire time (AUT-05) and must never
    // fail the request. notifyAuthAnomaly is already best-effort and self-logging.
    const detail = surge.alert;
    after(() => notifyAuthAnomaly(detail));
  }
  if (surge.blocked) {
    // AUT-05: the SAME uniform body and status as the per-identifier refusal above.
    return NextResponse.json(
      { ...UNIFORM },
      { status: 429, headers: { "Retry-After": String(SIGNUP_CEILING_RETRY_SEC) } },
    );
  }
```

- [ ] **Step 4: Run and verify they pass**

```bash
pnpm vitest run --no-file-parallelism tests/integration/signup-route.test.ts
```

Expected: all tests pass, 0 skipped.

- [ ] **Step 5: Stage**

```bash
git add src/app/api/auth/signup/route.ts tests/integration/signup-route.test.ts
git diff --cached --name-only
```

**Do not commit.**

---

### Task 4: Per-recipient cap on the "already registered" mail + docs

**Files:**
- Create: `src/lib/auth/already-registered-cap.ts`
- Modify: `src/app/api/auth/signup/route.ts` (the `existing` branch, currently line 89-93)
- Modify: `docs/adr/0032-*.md` (alert-code list), `docs/adr/0034-*.md` (ceiling + trade-off)
- Test: `tests/integration/signup-route.test.ts` (extend)

**Interfaces:**
- Consumes: `ALREADY_REGISTERED_CAP` (Task 2), `AuthAttemptsStore`, `rateDecision`.
- Produces: `allowAlreadyRegisteredMail(db: Db, email: string, now: number): Promise<boolean>` — returns `true` and consumes one unit of the recipient's budget, or `false` when the recipient is capped.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/signup-route.test.ts`, inside the suite. This needs a *pre-existing* email; the suite already provisions accounts, so reuse whatever helper it has for seeding an existing user — if it has none, seed one directly with `db.insert(schema.users)` mirroring the existing-email test already in the file.

```ts
  it("SEC-05 (WP-SU-8): caps the 'already registered' mail per recipient (no mail-bombing)", async () => {
    const email = existingUserEmail; // an address that already resolves in emailExistsGlobally
    clearDevMailbox();
    // The per-identifier signup limit is 5/15min, so 4 attempts stay inside it while
    // exceeding the 3/24h notice cap — that gap is exactly the mail-bomb window.
    for (let i = 0; i < 4; i++) {
      const res = await POST(jsonRequest("http://localhost:3000/api/auth/signup", {
        email, password: strongPassword(), workspaceName: "Bomb Co", captchaToken: "t", tosAccepted: true,
      }));
      expect(res.status).toBe(200); // AUT-05: uniform regardless of the cap
      await flushAfter();
    }
    const notices = recentDevEmails().filter((m) => m.meta?.kind === "already_registered");
    expect(notices).toHaveLength(ALREADY_REGISTERED_CAP.limit);
  });
```

Add `ALREADY_REGISTERED_CAP` to the `@/lib/auth/throttle` import in the test file.

- [ ] **Step 2: Run and verify it fails**

```bash
pnpm vitest run --no-file-parallelism tests/integration/signup-route.test.ts
```

Expected: FAIL — 4 notices delivered, expected 3.

- [ ] **Step 3: Implement the cap**

```ts
// src/lib/auth/already-registered-cap.ts
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";
import { AuthAttemptsStore } from "./attempts-store";
import { rateDecision } from "./rate-limit";
import { ALREADY_REGISTERED_CAP } from "./throttle";
import { logError } from "@/lib/observability";

// WP-SU-8: the "you already have an account" mail is VICTIM-DIRECTED — the attacker
// supplies someone else's address and that person receives the mail. The per-identifier
// signup throttle is keyed on the same address, so it caps the attacker at 5/15min ≈ 480
// mails/day INTO A STRANGER'S INBOX. This is the cap that closes that.
//
// Counted in auth_attempts under a synthetic kind rather than a new table: it is the same
// abuse counter, kind-namespaced, already RLS-locked and already indexed.
const NOTICE_KIND = "signup_notice";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Consume one unit of a recipient's notice budget. Returns false when they are capped.
 * Recorded with `success: true` DELIBERATELY: a `false` row feeds the AUT-04 lockout
 * ladder, and a stranger must never be able to lock an account by triggering notices.
 */
export async function allowAlreadyRegisteredMail(db: Db, email: string, now: number): Promise<boolean> {
  const attempts = new AuthAttemptsStore(db);
  const snap = await attempts.snapshot(email, null, NOTICE_KIND, now, {
    perIdentifier: ALREADY_REGISTERED_CAP,
    perIp: ALREADY_REGISTERED_CAP,
  });
  if (!rateDecision(snap.attempts, now, ALREADY_REGISTERED_CAP).allowed) {
    // SEC-05: the code and nothing else — the recipient address is user PII.
    logError("already_registered_mail_capped");
    return false;
  }
  await attempts.record(email, null, NOTICE_KIND, true);
  return true;
}
```

In `src/app/api/auth/signup/route.ts`, the existing-email branch becomes:

```ts
      if (existing) {
        // notifyAlreadyRegistered is best-effort and self-logging (never throws) — no wrapper needed.
        // WP-SU-8: capped per RECIPIENT, because this mail goes to a third party the
        // requester merely named.
        after(async () => {
          if (await allowAlreadyRegisteredMail(db, email, Date.now())) await notifyAlreadyRegistered(email);
        });
        return;
      }
```

with `import { allowAlreadyRegisteredMail } from "@/lib/auth/already-registered-cap";` added.

- [ ] **Step 4: Run and verify it passes**

```bash
pnpm vitest run --no-file-parallelism tests/integration/signup-route.test.ts
```

Expected: all pass, 0 skipped.

- [ ] **Step 5: Update the ADRs**

In `docs/adr/0032-*.md`, add to the Consequences alert-code list (the list WP-SU-2 amended — the owner builds Sentry alert rules from it):

```
- `already_registered_mail_capped` — a recipient hit the 3/24h "already registered" notice
  cap (WP-SU-8). One or two is noise; a burst means someone is probing a known address.
```

In `docs/adr/0034-*.md` (Turnstile), append a section recording that Turnstile is no longer the sole global bound:

```markdown
## Amendment (WP-SU-8, 2026-07-29): global signup ceiling

The per-identifier (5/15min) and per-IP (20/15min) signup throttles are both keyed on
attacker-chosen values, so before this WP the only global bound on distributed signup abuse
was Turnstile. A global rolling-hour ceiling of 60 now sits behind it, with an alert at 30.

Accepted trade-off: a global ceiling is by construction an availability lever — an attacker
who burns the hour's budget also refuses honest signups. This is inherent to every global
limit. It is accepted because the ceiling sits ~100x above expected volume, the alert fires
at half of it, and the alternative is unbounded tenant provisioning plus outbound mail. If
signup ever becomes a revenue path, revisit with a per-ASN or reputation-based bound.
```

- [ ] **Step 6: Full WP gate**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run --no-file-parallelism
```

Expected: typecheck clean, lint clean, unit ≥ 909 + the new ones, integration ≥ 224 + the new ones, **0 skipped**. Read the integration count — do not accept "skipped".

```bash
pnpm build
```

Expected: compiles, both runtimes.

- [ ] **Step 7: Stage and hand off for review**

```bash
git add src/lib/auth/already-registered-cap.ts src/app/api/auth/signup/route.ts tests/integration/signup-route.test.ts docs/adr
git diff --cached --name-only
```

Verify the list contains **no** `docs/legal/` path. Then: **reviews (pr-reviewer + audit-security mandatory; +audit-data for the migration) → fold findings, verifying each against real code → owner walkthrough → owner go → ONE commit → separate owner go → push.**

---

# WP-SU-9 — Atomic throttle decision + `reset/confirm` throttle

> **AS-BUILT DEVIATIONS (2026-07-30, from the plan text below + the review gate).**
> 1. **`rateDecisionWithSelf` (new).** Reserving before deciding puts the request's own row in the
>    window, so a plain `rateDecision` would have silently tightened every configured limit by one
>    (login 8→7, signup 5→4). `evaluateThrottle`, `signup/verify`, and `reset/confirm` use
>    `rateDecisionWithSelf` (= `rateDecision` with `limit + 1`). The Task 5/9 pseudocode below still
>    shows plain `rateDecision` — the shipped code is the correct version.
> 2. **`settle(attemptId, succeeded)`, not `settle(attemptId, !succeeded)`.** Task 9's pseudocode
>    inverted the flag; `settle`'s parameter is the SUCCESS flag. The integration test caught it
>    (a bogus token was being recorded as a success). Shipped code is correct.
> 3. **`evaluateSignupSurge` takes a self-inclusive `observed` count** (refuse on `observed > limit`,
>    warn on `observed >= surgeThreshold`), because the signup route's reservation is now counted by
>    the ceiling — which also CLOSED the WP-SU-8 ceiling TOCTOU residual.
> 4. **CAPTCHA moved before the reservation** (audit-security F-1). With the reservation counted by
>    the ceiling and written up front, CAPTCHA-after-reserve turned the ceiling into a CAPTCHA-free
>    single-IP DoS lever. `verifyTurnstile` now runs first; ADR-0034 amended. Regression test added
>    (an invalid-CAPTCHA request writes no `signup` row).
>
> Deliberately NOT done: pr-reviewer F-2 suggested wrapping every route's reserve→settle in
> try/finally for uniformity. Rejected for `login` specifically — settling `false` on an infra
> throw would feed the AUT-04 lockout ladder, a regression. Both reviewers agreed the current
> orphan-on-throw (reservation stays `success:true`) is fail-safe; documented in SPEC AUT-03 instead.
> Follow-up WP filed: pre-existing stranger-lockout via OTP/reset *request* flooding (audit-sec F-3).

**Why:** `evaluateThrottle` is snapshot-then-record (CWE-367). `snapshot()` reads the window, the decision is made, and `record()` writes the row *later* — so N concurrent requests all observe the same pre-burst state and all pass. On signup each pass provisions a user + tenant and sends mail. Separately, `/api/auth/reset/confirm` is now the last credential endpoint with no throttle at all.

**The fix, and why it is atomic without locks or transactions:**

Invert the order — **insert the attempt row first, then count.** Drizzle issues each statement in autocommit, so the reservation is committed before the snapshot query begins. Therefore every snapshot sees its own row plus every row committed before it started. Two concurrent requests cannot both miss each other: whichever counts last sees both. Formally, with limit L and L rows already present, two racing requests each see at least L+1 and both refuse. **The decision can over-block under contention; it can never under-block.** That is the correct direction for a rate limiter, and it needs no advisory lock (which would not survive Supabase's transaction-mode pooling as a session lock, and would add deadlock ordering to reason about) and no `SERIALIZABLE` retry loop.

**The one subtlety — the lockout ladder.** `auth_attempts.success` is dual-purpose: *all* rows feed the rate window, but only `success: false` rows feed the AUT-04 progressive lockout. If a reservation were written as `false`, then a refused request would count as a credential failure, and anyone could permanently lock a victim's account just by hammering the endpoint. So:

- **`reserve()` writes `success: true`** — outcome-neutral, invisible to the lockout ladder.
- **`settle(id, success)` writes the real outcome** at exactly the point each route calls `record()` today.

Net effect: a *completed* request produces a byte-identical row to today. Only a request refused at the gate differs — it now consumes rate budget but not lockout budget. Deliberate and documented.

**Behaviour change to call out at the walkthrough:** a 429'd request now consumes rate budget, so a client that hammers through a refusal extends its own window. Recommended and kept (fail-closed, one fewer statement than delete-on-refuse, and no UI in this app auto-retries). Reject it at walkthrough if you'd rather refusals be free.

---

### Task 5: `reserve` / `settle` on the store, and the concurrency proof

**Files:**
- Modify: `src/lib/auth/attempts-store.ts:22-26` (replace `record`)
- Test: `tests/integration/throttle-atomicity.test.ts`

**Interfaces:**
- Produces:
  - `AuthAttemptsStore.reserve(identifier: string, ip: string | null, kind: string): Promise<string>` — inserts with `success: true`, returns the row id.
  - `AuthAttemptsStore.settle(id: string, success: boolean): Promise<void>` — sets the real outcome.
  - `record()` is **kept** (Task 4's notice cap and the existing tests use it) and documented as "outcome known up front; not part of a throttle decision".

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/throttle-atomicity.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, type ThrottleConfig } from "@/lib/auth/throttle";

// WP-SU-9 (CWE-367): the throttle decision used to be snapshot-then-record, so N
// concurrent requests all read the same pre-burst window and ALL passed. On signup each
// pass provisions a tenant and sends mail. Self-skips without DATABASE_URL (must NOT
// self-skip here).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

const CFG: ThrottleConfig = {
  perIdentifier: { limit: 3, windowMs: 900_000 },
  perIp: { limit: 100, windowMs: 900_000 }, // wide, so the identifier limit is what binds
};

suite("AUT-03 (WP-SU-9): the throttle decision is atomic under concurrency", () => {
  const db = getDb();
  const store = new AuthAttemptsStore(db);
  const kinds: string[] = [];

  afterEach(async () => {
    for (const k of kinds.splice(0)) {
      await db.delete(schema.authAttempts).where(eq(schema.authAttempts.kind, k));
    }
  });

  /** One request's gate: reserve, then decide from a window that includes the reservation. */
  async function gate(id: string, kind: string): Promise<boolean> {
    const attemptId = await store.reserve(id, "203.0.113.7", kind);
    const now = Date.now();
    const snap = await store.snapshot(id, "203.0.113.7", kind, now, CFG);
    const ok = evaluateThrottle(snap, now, CFG).ok;
    await store.settle(attemptId, !ok);
    return ok;
  }

  it("AUT-03: 10 concurrent requests never exceed the limit (was: all 10 passed)", async () => {
    const kind = `atomic_${randomUUID().slice(0, 8)}`;
    kinds.push(kind);
    const id = `burst-${randomUUID()}@example.test`;
    const results = await Promise.all(Array.from({ length: 10 }, () => gate(id, kind)));
    const passed = results.filter(Boolean).length;
    // Fail-CLOSED: contention may refuse more than the limit, never fewer.
    expect(passed).toBeLessThanOrEqual(CFG.perIdentifier.limit);
  });

  it("AUT-03: a lone request still passes (the limiter is not vacuously closed)", async () => {
    const kind = `atomic_${randomUUID().slice(0, 8)}`;
    kinds.push(kind);
    expect(await gate(`solo-${randomUUID()}@example.test`, kind)).toBe(true);
  });

  it("AUT-04: a reservation never feeds the lockout ladder until it is settled", async () => {
    const kind = `atomic_${randomUUID().slice(0, 8)}`;
    kinds.push(kind);
    const id = `ladder-${randomUUID()}@example.test`;
    await store.reserve(id, null, kind);
    const snap = await store.snapshot(id, null, kind, Date.now(), CFG);
    expect(snap.attempts).toHaveLength(1); // counts toward the rate window...
    expect(snap.failures).toHaveLength(0); // ...but not toward lockout.
  });

  it("AUT-04: settling a failure DOES feed the lockout ladder", async () => {
    const kind = `atomic_${randomUUID().slice(0, 8)}`;
    kinds.push(kind);
    const id = `ladder2-${randomUUID()}@example.test`;
    const attemptId = await store.reserve(id, null, kind);
    await store.settle(attemptId, false);
    const snap = await store.snapshot(id, null, kind, Date.now(), CFG);
    expect(snap.failures).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

```bash
pnpm vitest run --no-file-parallelism tests/integration/throttle-atomicity.test.ts
```

Expected: FAIL — `store.reserve is not a function`.

**Then prove the test is real** (carried lesson 3 — a test that passes immediately proves nothing). Temporarily replace the body of `gate` with the *old* order and re-run:

```ts
  // TEMPORARY — the pre-WP-SU-9 order, to prove the test catches the TOCTOU.
  async function gate(id: string, kind: string): Promise<boolean> {
    const now = Date.now();
    const snap = await store.snapshot(id, "203.0.113.7", kind, now, CFG);
    const ok = evaluateThrottle(snap, now, CFG).ok;
    await store.record(id, "203.0.113.7", kind, !ok);
    return ok;
  }
```

Expected: the first test FAILS with `passed` = 10 (or well above 3). **Record that number in the WP report** — it is the evidence the bug was real. Then restore the `reserve`-based `gate`.

- [ ] **Step 3: Implement `reserve` and `settle`**

In `src/lib/auth/attempts-store.ts`, replace the `record` method with:

```ts
  /**
   * WP-SU-9 (CWE-367): reserve this attempt BEFORE the throttle decision, so the snapshot
   * that follows counts it. Drizzle autocommits each statement, so the row is committed
   * before the snapshot query starts — every snapshot therefore sees its own row plus all
   * rows committed before it. Two racing requests cannot both miss each other: whichever
   * counts last sees both. The decision can over-block under contention and can never
   * under-block, which is the correct direction for a limiter.
   *
   * Written as success:TRUE deliberately. `success` is dual-purpose — every row feeds the
   * rate window, but only `false` rows feed the AUT-04 lockout ladder. A `false`
   * reservation would let a stranger lock a victim's account by hammering the endpoint,
   * since a REFUSED request never reaches the code that would settle it.
   */
  async reserve(identifier: string, ip: string | null, kind: string): Promise<string> {
    const [row] = await this.db
      .insert(schema.authAttempts)
      .values({ identifier: identifier.toLowerCase(), ip, kind, success: true })
      .returning({ id: schema.authAttempts.id });
    return row.id;
  }

  /**
   * Record the real outcome of a reserved attempt, at the point the route previously
   * called `record`. A completed request therefore produces a row identical to the
   * pre-WP-SU-9 one; only a request refused at the gate differs (it consumes rate budget
   * but not lockout budget). Always writes, including `true` — an unconditional statement
   * is cheaper to reason about than a no-op that silently depends on reserve's default.
   */
  async settle(id: string, success: boolean): Promise<void> {
    await this.db.update(schema.authAttempts).set({ success }).where(eq(schema.authAttempts.id, id));
  }

  /**
   * Record an attempt whose outcome is known up front and which is NOT part of a throttle
   * decision (WP-SU-8's per-recipient notice budget). Throttled endpoints use
   * reserve/settle — using this one there reintroduces the TOCTOU.
   */
  async record(identifier: string, ip: string | null, kind: string, success: boolean): Promise<void> {
    await this.db
      .insert(schema.authAttempts)
      .values({ identifier: identifier.toLowerCase(), ip, kind, success });
  }
```

- [ ] **Step 4: Run and verify it passes**

```bash
pnpm vitest run --no-file-parallelism tests/integration/throttle-atomicity.test.ts
```

Expected: 4 passed, 0 skipped.

- [ ] **Step 5: Stage**

```bash
git add src/lib/auth/attempts-store.ts tests/integration/throttle-atomicity.test.ts
git diff --cached --name-only
```

**Do not commit.**

---

### Task 6: Migrate the three uniform-response routes

These three call `record(..., false)` unconditionally inside their uniform-timing block. Converting them is a reorder plus a rename.

**Files:**
- Modify: `src/app/api/auth/signup/route.ts` (lines ~61 and ~84)
- Modify: `src/app/api/auth/reset/request/route.ts:41-53`
- Modify: `src/app/api/auth/otp/request/route.ts:38-47`
- Test: `tests/integration/signup-route.test.ts`, `tests/integration/reset-request-route.test.ts`, `tests/integration/otp-request-route.test.ts` (existing suites must stay green; add one assertion each)

**Interfaces:**
- Consumes: `reserve`/`settle` (Task 5).

- [ ] **Step 1: Add the regression assertion to each suite**

For each of the three routes, add one test asserting the row bookkeeping is unchanged for a completed request. Example for reset/request (adapt the identifiers and imports per suite):

```ts
  it("AUT-03 (WP-SU-9): a completed request still records exactly one attempt row", async () => {
    const email = `su9-${randomUUID()}@example.test`;
    await POST(jsonRequest("http://localhost:3000/api/auth/reset/request", { email }));
    const rows = await db.select().from(schema.authAttempts)
      .where(and(eq(schema.authAttempts.identifier, email), eq(schema.authAttempts.kind, "reset")));
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(false); // identical to the pre-WP-SU-9 row
  });
```

- [ ] **Step 2: Run and confirm they pass on the current code**

```bash
pnpm vitest run --no-file-parallelism tests/integration/reset-request-route.test.ts tests/integration/otp-request-route.test.ts tests/integration/signup-route.test.ts
```

Expected: PASS. This is a **characterization test** — it pins today's behaviour so the refactor cannot silently change it. It is supposed to pass now.

- [ ] **Step 3: Convert `reset/request`**

Replace lines 41-42:

```ts
  // WP-SU-9 (CWE-367): reserve BEFORE deciding, so this request is inside the window it
  // is judged against. Snapshot-then-record let N concurrent requests all pass.
  const attemptId = await attempts.reserve(email, ip, KIND);
  const snap = await attempts.snapshot(email, ip, KIND, now, RESET_THROTTLE);
  const throttle = evaluateThrottle(snap, now, RESET_THROTTLE);
```

and inside the uniform block, replace `await attempts.record(email, ip, KIND, false);` with:

```ts
      await attempts.settle(attemptId, false);
```

- [ ] **Step 4: Convert `otp/request` the same way**

Replace lines 38-39 with the reserve-then-snapshot pair (using `OTP_THROTTLE`), and line 47's `record(email, ip, KIND, false)` with `settle(attemptId, false)`.

- [ ] **Step 5: Convert `signup`**

Replace line 61 with the reserve-then-snapshot pair (using `SIGNUP_THROTTLE`), and line 84's `await attempts.record(email, ip, KIND, false);` with `await attempts.settle(attemptId, false);`.

**Ordering note:** the reservation must come before *both* the per-identifier decision and WP-SU-8's global count, so the request is inside the global window it is judged against too. Place `reserve` as the first statement after `const attempts = new AuthAttemptsStore(db);`, and leave the Task 3 global block where it is.

- [ ] **Step 6: Run all three suites**

```bash
pnpm vitest run --no-file-parallelism tests/integration/reset-request-route.test.ts tests/integration/otp-request-route.test.ts tests/integration/signup-route.test.ts
```

Expected: all pass, 0 skipped. If a rate-limit test in an existing suite now fails by one attempt, that is the intended semantics change (a refused request consumes budget) — update the expectation and note it in the report; do not weaken the limit.

- [ ] **Step 7: Stage**

```bash
git add src/app/api/auth/signup/route.ts src/app/api/auth/reset/request/route.ts src/app/api/auth/otp/request/route.ts tests/integration
git diff --cached --name-only
```

**Do not commit.**

---

### Task 7: Migrate the two outcome-bearing routes

**Files:**
- Modify: `src/app/api/auth/login/route.ts:41-65`
- Modify: `src/app/api/auth/otp/verify/route.ts:47-51`
- Test: `tests/integration/login-route.test.ts`, `tests/integration/otp-verify-route.test.ts` (existing suites)

- [ ] **Step 1: Add the lockout-ladder regression test to the login suite**

```ts
  it("AUT-04 (WP-SU-9): a rate-limited request does NOT count toward lockout", async () => {
    const email = `ladder-${randomUUID()}@example.test`;
    // Exhaust the rate window with requests that are refused at the gate.
    for (let i = 0; i < LOGIN_THROTTLE.perIdentifier.limit + 3; i++) {
      await POST(jsonRequest("http://localhost:3000/api/auth/login", { email, password: "wrong-but-unused" }));
    }
    const rows = await db.select().from(schema.authAttempts)
      .where(and(eq(schema.authAttempts.identifier, email), eq(schema.authAttempts.kind, "login")));
    const failures = rows.filter((r) => !r.success).length;
    // Only the requests that actually reached Supabase are failures. If refusals counted,
    // a stranger could lock any account by hammering it.
    expect(failures).toBeLessThanOrEqual(LOGIN_THROTTLE.perIdentifier.limit);
  });
```

- [ ] **Step 2: Run and verify it fails**

```bash
pnpm vitest run --no-file-parallelism tests/integration/login-route.test.ts
```

Expected: currently PASSES (today refusals write no row at all). Keep it — it is the guard that the WP-SU-9 refactor must not break. Note in the report that it is a characterization test, not a red-then-green one.

- [ ] **Step 3: Convert `login`**

Replace lines 41-42:

```ts
  // WP-SU-9 (CWE-367): reserve BEFORE deciding. The reservation is success:true so a
  // request refused HERE never feeds the AUT-04 ladder — otherwise a stranger could lock
  // any account by hammering it. The real outcome is settled below.
  const attemptId = await store.reserve(email, ip, KIND);
  const snapshot = await store.snapshot(email, ip, KIND, now, LOGIN_THROTTLE);
  const throttle = evaluateThrottle(snapshot, now, LOGIN_THROTTLE);
```

and replace line 65 `await store.record(email, ip, KIND, success === true);` with:

```ts
  await store.settle(attemptId, success === true);
```

Everything downstream (the `lockoutState(snapshot.failures.length + 1)` notification and the `ipFailureCount` anomaly check) is unchanged and still correct: `snapshot` is still read before the attempt, and `settle` still lands before both reads.

- [ ] **Step 4: Convert `otp/verify`**

Replace lines 47-51 with:

```ts
  const attemptId = await attempts.reserve(email, ip, KIND);
  const snap = await attempts.snapshot(email, ip, KIND, now, OTP_THROTTLE);
  if (!evaluateThrottle(snap, now, OTP_THROTTLE).ok) {
    return NextResponse.json({ ...INVALID }, { status: 429, headers: { "Retry-After": "60" } });
  }
  await attempts.settle(attemptId, false);
```

(`otp/verify` records `false` immediately after the gate today and never revises it — the OTP challenge's own `incrementAttempt`/`consume` carries the real outcome. Preserve that exactly.)

- [ ] **Step 5: Run both suites**

```bash
pnpm vitest run --no-file-parallelism tests/integration/login-route.test.ts tests/integration/otp-verify-route.test.ts
```

Expected: all pass, 0 skipped.

- [ ] **Step 6: Stage**

```bash
git add src/app/api/auth/login/route.ts src/app/api/auth/otp/verify/route.ts tests/integration
git diff --cached --name-only
```

**Do not commit.**

---

### Task 8: Migrate `signup/verify`

**Files:**
- Modify: `src/app/api/auth/signup/verify/route.ts:37-79`
- Test: `tests/integration/signup-verify-route.test.ts` (existing suite)

- [ ] **Step 1: Convert the route**

Replace lines 37-38:

```ts
  const attempts = new AuthAttemptsStore(db);
  // WP-SU-9: reserve before deciding (CWE-367). See attempts-store.reserve.
  const attemptId = await attempts.reserve(tokenKey, ip, VERIFY_KIND);
  const snap = await attempts.snapshot(tokenKey, ip, VERIFY_KIND, now, VERIFY_THROTTLE);
```

and the `finally` block at line 77-79:

```ts
  } finally {
    await attempts.settle(attemptId, verified);
  }
```

The `try/finally` comment above it stays accurate — every post-gate exit still consumes budget exactly once. Extend it with one line noting the reservation now happens at the gate, so a request refused *at* the gate also consumes rate budget (which is the point).

- [ ] **Step 2: Run the suite**

```bash
pnpm vitest run --no-file-parallelism tests/integration/signup-verify-route.test.ts
```

Expected: all pass, 0 skipped.

- [ ] **Step 3: Stage**

```bash
git add src/app/api/auth/signup/verify/route.ts
```

**Do not commit.**

---

### Task 9: Throttle `/api/auth/reset/confirm`

**Why:** it is the last credential endpoint with no throttle. It performs a token lookup, an HIBP breach lookup, a Supabase admin password write, a sign-in, and a global sign-out — all unbounded.

**Files:**
- Modify: `src/lib/auth/throttle.ts` (append `RESET_CONFIRM_THROTTLE`)
- Modify: `src/app/api/auth/reset/confirm/route.ts:22-33`
- Modify: `docs/SPEC.md` (the AUT-03 throttled-endpoint list)
- Test: `tests/integration/reset-confirm-throttle.test.ts`

**Interfaces:**
- Consumes: `reserve`/`settle` (Task 5), `rateDecision`, `sha256Hex` (already imported in the route).
- Produces: `RESET_CONFIRM_THROTTLE: ThrottleConfig`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/reset-confirm-throttle.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { RESET_CONFIRM_THROTTLE } from "@/lib/auth/throttle";
import { jsonRequest } from "./_route-harness";
import { POST } from "@/app/api/auth/reset/confirm/route";

// AUT-03 (WP-SU-9): reset/confirm was the last credential endpoint with no throttle.
// Self-skips without DATABASE_URL (must NOT self-skip here).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("POST /api/auth/reset/confirm — throttle (WP-SU-9)", () => {
  it("AUT-03: refuses with 429 + Retry-After past the per-token limit", async () => {
    // One token, replayed. A bogus token is fine — the throttle runs BEFORE the lookup,
    // which is the point: an unthrottled endpoint costs a DB read per guess.
    const token = `tok-${randomUUID()}${randomUUID()}`;
    const call = () => POST(jsonRequest("http://localhost:3000/api/auth/reset/confirm", {
      token, newPassword: `Correct-Horse-${randomUUID()}-9!`,
    }));

    for (let i = 0; i < RESET_CONFIRM_THROTTLE.perIdentifier.limit; i++) {
      expect((await call()).status).toBe(400); // reset_invalid — allowed through
    }
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = await blocked.json();
    expect(body.code).toBe("too_many_requests");
    expect(body.traceId).toBeTruthy(); // uniform {code,message,traceId} envelope
  });

  it("SEC-05: the throttle key is a hash prefix, never the token itself", async () => {
    // Guard against a future refactor keying on the raw token: auth_attempts.identifier
    // is queried and logged, and a live reset token there is an account-takeover credential.
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/app/api/auth/reset/confirm/route.ts", "utf8"));
    expect(src).toMatch(/sha256Hex\(token\)\.slice\(0, 16\)/);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
pnpm vitest run --no-file-parallelism tests/integration/reset-confirm-throttle.test.ts
```

Expected: FAIL — every call returns 400, never 429.

- [ ] **Step 3: Add the config**

Append to `src/lib/auth/throttle.ts`:

```ts
// Reset completion (WP-SU-9, AUT-03) — the last credential endpoint without a throttle.
// Same shape and reasoning as VERIFY_THROTTLE: the identifier is a truncated hash of the
// presented token (never the token — SEC-05), which bounds replays of ONE link; the per-IP
// limit is what bounds guessing across different tokens. Unthrottled, each guess cost a
// token lookup, an HIBP range fetch, a Supabase password write and a global sign-out.
export const RESET_CONFIRM_THROTTLE: ThrottleConfig = {
  perIdentifier: { limit: 10, windowMs: 900_000 }, // 10 / 15min per token
  perIp: { limit: 20, windowMs: 900_000 }, // 20 / 15min per IP
};
```

- [ ] **Step 4: Wire it into the route**

In `src/app/api/auth/reset/confirm/route.ts`, add imports:

```ts
import { NextResponse } from "next/server";
import { newTraceId } from "@/lib/http";
import { clientIp } from "@/lib/auth/client-ip";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { RESET_CONFIRM_THROTTLE } from "@/lib/auth/throttle";
import { rateDecision } from "@/lib/auth/rate-limit";
```

(`jsonError`/`jsonOk` are already imported from `@/lib/http`; add `newTraceId` to that same import rather than a second statement.)

Then after `const store = new ResetStore(db);` (line 32), and **before** the `findByHash` lookup, insert:

```ts
  // AUT-03 (WP-SU-9): the last credential endpoint without a throttle. Sliding window
  // ONLY — deliberately not evaluateThrottle, for the same reason signup/verify avoids it:
  // that composes AUT-04's progressive lockout, whose two escape hatches (owner
  // notification and an admin clearFailures) are both unreachable for a key derived from a
  // token that exists only in the user's inbox, and it would turn an honest "this link
  // expired" into a "wait and try again" that waiting never fixes.
  // The key is a truncated hash — never the token (SEC-05).
  const tokenKey = sha256Hex(token).slice(0, 16);
  const ip = clientIp(request);
  const attempts = new AuthAttemptsStore(db);
  const attemptId = await attempts.reserve(tokenKey, ip, "reset_confirm");
  const snap = await attempts.snapshot(tokenKey, ip, "reset_confirm", now, RESET_CONFIRM_THROTTLE);
  const byToken = rateDecision(snap.attempts, now, RESET_CONFIRM_THROTTLE.perIdentifier);
  const byIp = rateDecision(snap.ipAttempts, now, RESET_CONFIRM_THROTTLE.perIp);
  if (!byToken.allowed || !byIp.allowed) {
    const retryAfterSec = Math.ceil(Math.max(byToken.retryAfterMs, byIp.retryAfterMs) / 1000);
    return NextResponse.json(
      { code: "too_many_requests", message: "Too many attempts. Please wait and try again.", traceId: newTraceId() },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }
```

Wrap the remainder of the handler (from `const record = await store.findByHash(...)` to the final `return jsonOk(...)`) in `try { ... } finally { await attempts.settle(attemptId, !succeeded); }`, mirroring `signup/verify`: declare `let succeeded = false;` before the `try` and set `succeeded = true;` immediately before the final `jsonOk` return. That guarantees every post-gate exit — including the Supabase error branch and any throw — settles exactly once.

The existing `sha256Hex(token)` call at line 33 stays as-is (full hash for the lookup); `tokenKey` is the separate truncated key. Do not conflate them.

- [ ] **Step 5: Run and verify it passes**

```bash
pnpm vitest run --no-file-parallelism tests/integration/reset-confirm-throttle.test.ts
```

Expected: 2 passed, 0 skipped.

- [ ] **Step 6: Update the SPEC**

In `docs/SPEC.md`, find the AUT-03 endpoint list (near line 289 — the list WP-SU-1 amended to include signup) and add `/api/auth/reset/confirm` to it, so "every credential endpoint wires a throttle kind" is a statement the spec actually makes true. Add `'reset_confirm'` to the `kind` comment in `src/db/schema.ts:556` as well.

- [ ] **Step 7: Full WP gate**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run --no-file-parallelism && pnpm build
```

Expected: clean, all suites green, **0 skipped**, build compiles both runtimes.

- [ ] **Step 8: Stage and hand off for review**

```bash
git add src/lib/auth/throttle.ts src/app/api/auth/reset/confirm/route.ts src/db/schema.ts docs/SPEC.md tests/integration/reset-confirm-throttle.test.ts
git diff --cached --name-only
```

Then: **reviews (pr-reviewer + audit-security mandatory) → fold findings, verifying each against real code → owner walkthrough → owner go → ONE commit → separate owner go → push.**

---

# WP-SU-10 — `onRequestError` wiring

**Why:** `src/instrumentation.ts` exports only `register`, so App Router route-handler errors never reach Sentry at all. Every carefully-scrubbed `logError` path works, but an *uncaught* throw inside a route handler is invisible.

**The finding this task exists because of (carried lesson 2 — read the SDK and ask what it means for OUR payloads):** `Sentry.captureRequestError` does two things beyond capturing the exception:

```js
scope.setSDKProcessingMetadata({ normalizedRequest: { headers: headersToDict(request.headers), method } });
scope.setContext("nextjs", { request_path: request.path, router_kind, router_path, route_type });
```

- The **headers** land in `event.request.headers`, which the existing `beforeSend` already deletes. Covered.
- The **`request_path`** lands in `event.contexts.nextjs.request_path`, which the existing `beforeSend` **does not touch**. It strips the query only from `event.request.url`. We email reset links as `/reset?token=<live 30-min token>` and signup links as `/signup/verify?token=…`, so a throw during one of those requests would ship an account-takeover credential to a third party through a field nothing currently scrubs. **This task must extend `beforeSend` to cover it.**

**Accepted residual (unchanged, already in ADR-0032):** uncaught errors printed by Next/Node reach the hosting provider's log store before any of our code runs. `onRequestError` closes the Sentry gap, not that one.

---

### Task 10: Export `onRequestError` and extend the scrubber

**Files:**
- Modify: `src/instrumentation.ts` (extend `beforeSend`; append the new export)
- Modify: `docs/adr/0032-*.md`
- Test: `tests/unit/instrumentation-request-error.test.ts`
- Test: `tests/unit/instrumentation.test.ts` (add the context-scrub case; extend the existing `vi.mock`)

**Interfaces:**
- Consumes: `Sentry.captureRequestError(error: unknown, request: {path, method, headers}, errorContext: {routerKind, routePath, routeType})` — verified present in **both** the server and edge builds of `@sentry/nextjs` 10.65 (`build/cjs/index.server.js` and `build/cjs/edge/index.js`), so a static import is safe here. This is exactly the check that `Sentry.httpIntegration` failed during WP-SU-3; do not skip it on a version bump.
- Produces: `onRequestError` named export from `@/instrumentation`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/instrumentation-request-error.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/env";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  consoleIntegration: vi.fn(() => ({ name: "Console" })),
  httpIntegration: vi.fn(() => ({ name: "Http" })),
  captureRequestError: vi.fn(),
}));

const captureRequestError = vi.mocked(Sentry.captureRequestError);
const setDsn = (dsn: string | undefined) => { (env as { SENTRY_DSN?: string }).SENTRY_DSN = dsn; };
const loadHook = async () => (await import("@/instrumentation")).onRequestError;

// A realistic Next 16 onRequestError payload (next/dist/server/instrumentation/types).
const REQ = { path: "/api/auth/reset/confirm", method: "POST", headers: { cookie: "__Host-x=secret" } };
const CTX = { routerKind: "App Router" as const, routePath: "/api/auth/reset/confirm", routeType: "route" as const, revalidateReason: undefined };

beforeEach(() => {
  captureRequestError.mockReset();
  setDsn(undefined);
});

describe("ADR-0032 (WP-SU-10): App Router handler errors reach Sentry", () => {
  it("ACT-03: forwards the error, request and context to Sentry", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const err = new Error("boom");
    await (await loadHook())(err, REQ, CTX);
    expect(captureRequestError).toHaveBeenCalledTimes(1);
    expect(captureRequestError).toHaveBeenCalledWith(err, REQ, CTX);
  });

  it("SEC-07: stays inert when SENTRY_DSN is unset (dev/test/CI/preview)", async () => {
    await (await loadHook())(new Error("boom"), REQ, CTX);
    expect(captureRequestError).not.toHaveBeenCalled();
  });

  it("ADR-0032: never throws — a failing transport must not break error handling", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    captureRequestError.mockImplementation(() => { throw new Error("transport down"); });
    await expect((await loadHook())(new Error("boom"), REQ, CTX)).resolves.toBeUndefined();
  });
});
```

Add to the existing `tests/unit/instrumentation.test.ts` (and add `captureRequestError: vi.fn()` to its `vi.mock` factory so both files mock the same surface):

```ts
  // WP-SU-10: captureRequestError writes request.path into contexts.nextjs.request_path —
  // a field the url-stripping above does NOT cover. We email /reset?token=<live token>, so
  // a throw during that request would ship an account-takeover credential (SEC-05).
  it("SEC-05: beforeSend strips the query from contexts.nextjs.request_path", async () => {
    setDsn("https://key@o1.ingest.sentry.io/1");
    const register = await loadRegister();
    await register();
    const out = beforeSendFn()(
      { contexts: { nextjs: { request_path: "/reset?token=SUPER_SECRET_RESET_TOKEN", route_type: "route" } } } as never,
      {},
    ) as unknown as { contexts?: { nextjs?: { request_path?: string } } };
    expect(out.contexts?.nextjs?.request_path).toBe("/reset");
    expect(JSON.stringify(out)).not.toContain("SUPER_SECRET_RESET_TOKEN");
  });
```

- [ ] **Step 2: Run and verify both fail**

```bash
pnpm vitest run --no-file-parallelism tests/unit/instrumentation-request-error.test.ts tests/unit/instrumentation.test.ts
```

Expected: the new file fails (`onRequestError is not a function`); the `request_path` case fails (query survives).

- [ ] **Step 3: Extend `beforeSend`**

In `src/instrumentation.ts`, inside `beforeSend`, immediately after the `event.request` block:

```ts
      // WP-SU-10: captureRequestError puts the REQUEST PATH in a context, not in
      // event.request.url — so the strip above misses it entirely. Reset and signup-verify
      // links carry a live single-use token in the query string, which is an
      // account-takeover credential in a third party's store (SEC-05, same reasoning as
      // request.url). Strip it here too; scrub the rest of the context for free.
      const nextjs = event.contexts?.nextjs as Record<string, unknown> | undefined;
      if (nextjs) {
        const path = nextjs.request_path;
        if (typeof path === "string") nextjs.request_path = path.split("?")[0];
        event.contexts!.nextjs = scrubDetail(nextjs);
      }
```

- [ ] **Step 4: Add the hook**

Append to `src/instrumentation.ts`:

```ts
/**
 * WP-SU-10 / ACT-03: Next calls this for every error thrown out of a route handler, server
 * component render or server action. Without it, App Router handler errors reached NO sink
 * of ours — `logError` only sees the errors we catch ourselves.
 *
 * Delegates to the SDK rather than re-implementing capture, so the exception arrives with
 * its stack and Next's routing context. Everything it produces still passes through the
 * `beforeSend` above, which is where the scrubbing happens (including request_path — see
 * the note there; that field is the reason this task touched beforeSend at all).
 *
 * Gated on SENTRY_DSN to mirror `register`: without init, capture is a silent no-op
 * anyway, but an explicit gate is testable and says what we mean.
 *
 * Types come from the SDK, not from `next` — Next 16 does not re-export the
 * `Instrumentation` namespace from the package root, and a deep import into
 * next/dist/server/... is not a stable contract to bind to.
 *
 * ACCEPTED RESIDUAL (ADR-0032): uncaught errors PRINTED by Next/Node still reach the
 * hosting provider's log store before any of our code runs. This closes the Sentry gap,
 * not that one.
 */
type CaptureArgs = Parameters<typeof Sentry.captureRequestError>;

export function onRequestError(
  error: unknown,
  request: CaptureArgs[1],
  context: CaptureArgs[2],
): void {
  if (!env.SENTRY_DSN) return;
  try {
    Sentry.captureRequestError(error, request, context);
  } catch {
    // Error reporting must never break error handling.
  }
}
```

- [ ] **Step 5: Run and verify they pass**

```bash
pnpm vitest run --no-file-parallelism tests/unit/instrumentation-request-error.test.ts tests/unit/instrumentation.test.ts
```

Expected: all pass.

- [ ] **Step 6: The unmocked probe (carried lesson 1)**

The unit tests mock `@sentry/nextjs` wholesale and therefore cannot see whether the real module exports `captureRequestError` in each runtime. Verify against the real package:

```bash
node -e "const s=require('@sentry/nextjs');console.log('server:',typeof s.captureRequestError)"
node -e "const s=require('./node_modules/@sentry/nextjs/build/cjs/edge/index.js');console.log('edge:',typeof s.captureRequestError)"
```

Expected: `server: function` and `edge: function`. If either says `undefined`, **stop** — this is the exact shape of the WP-SU-3 edge-build break, and the hook needs the same dynamic-access treatment `httpIntegration` got.

- [ ] **Step 7: The real build (carried lesson 1)**

```bash
pnpm build
```

Expected: compiles, both runtimes, no "export not found" error from the edge bundle.

- [ ] **Step 8: Check the ADR-0032 import allowlist**

```bash
pnpm vitest run --no-file-parallelism tests/unit/no-client-sentry.test.ts
```

Expected: PASS. `src/instrumentation.ts` is already on the allowlist (it imports Sentry today), so no change should be needed — but run it, because WP-SU-2 was caught by exactly this test at the last moment.

- [ ] **Step 9: Update ADR-0032**

Narrow the residual note in `docs/adr/0032-*.md`. Replace the claim that App Router handler errors never reach Sentry with:

```markdown
### Amendment (WP-SU-10, 2026-07-29)

`src/instrumentation.ts` now also exports `onRequestError`, so errors thrown out of App
Router route handlers, server component renders and server actions reach Sentry with their
stack and routing context. They pass through the same `beforeSend` as every other event.

That hook introduced one new PII path, now closed: `captureRequestError` writes the request
path into `contexts.nextjs.request_path`, which the existing `request.url` query-strip did
not cover — and reset/signup-verify links carry a live single-use token in the query.
`beforeSend` strips and scrubs that context.

STILL RESIDUAL, unchanged: uncaught errors printed by Next/Node reach the hosting
provider's log store before any of our code runs. No in-app hook can cover that path; it is
bounded by choosing a host whose log retention we accept.
```

- [ ] **Step 10: Full WP gate, stage, hand off**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run --no-file-parallelism && pnpm build
```

```bash
git add src/instrumentation.ts tests/unit/instrumentation-request-error.test.ts tests/unit/instrumentation.test.ts docs/adr
git diff --cached --name-only
```

Then: **reviews (pr-reviewer + audit-security mandatory) → fold findings → owner walkthrough → owner go → ONE commit → separate owner go → push.**

---

# Part 4 — Production-like deployment

**Not a TDD task.** This is a walkthrough I drive and you execute; I cannot run it (no Vercel CLI and no Vercel auth in-session — the Vercel MCP server is also unauthorized here). Every step below is something you do, with me checking the result.

**Decisions already made (not re-opened here):** reuse the Frankfurt Supabase for now, with a US project before real customers (ADR-0003); real email via Resend on your domain; onboard the tester through the app's own invite flow, not scripts; `SIGNUP_ENABLED` stays off.

**Deployment order (each step is verifiable before the next):**

1. **Vercel project + plan.** Import the repo, set production branch. Pro is required for the `*/5` outbox cron — Hobby will not run it, so digests silently stop. `vercel.json` already declares the schedules.
2. **Environment variables.** The full list, with the boot-time constraints the code actually enforces (I will produce this as a copy-paste table at walkthrough time — the non-obvious ones are: `APP_URL` must not be the localhost default; `RESEND_API_KEY` and a non-placeholder `EMAIL_FROM` are both required or boot fails; **`TURNSTILE_SITE_KEY` *and* `TURNSTILE_SECRET_KEY` are required in production even though signup is off** — `env.ts` refines on `APP_ENV`, not on `SIGNUP_ENABLED`; `CRON_SECRET` must be 32+ chars that the log scrubber fully redacts, so `openssl rand -base64 32` alone **fails** the check — use `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`).
3. **Database.** Point `DATABASE_URL` at the Frankfurt project's **pooler** string and apply migrations `0000`–`0027`. Note for the record: this is a Frankfurt deployment, so no real seller PII goes in until the US project exists (ADR-0003, LGL-03).
4. **Resend + DNS.** Add the domain, publish the SPF/DKIM (and DMARC) records at your registrar, wait for verification, then set `EMAIL_FROM` to a verified sender on that domain. This is the step with a waiting period — start it early.
5. **Sentry.** Create the project, set `SENTRY_DSN`. WP-SU-10 is what makes route-handler errors show up there, which is why it lands before this.
6. **Deploy, then verify** — `/api/health`, a real login, a partner invite that actually arrives, and one deliberate route error to confirm it appears in Sentry with the query string stripped.
7. **Uptime watchdog** on `/api/health`, and **branch protection** on `main`.
8. **Onboard the tester** through the in-app invite flow.

**Also flag at that walkthrough:** `docs/GO-LIVE-CHECKLIST.md` is stale — item A still says the Sentry SDK is unwired (it shipped in `9f05f22`), and it predates the `SIGNUP_ENABLED`, Turnstile and `CRON_SECRET`-format requirements. It gets a refresh pass as part of this step, not before.

---

## Self-review

**Spec coverage.** WP-SU-8's three specced parts → Tasks 1+3 (global ceiling), Tasks 2+3 (surge alert mirroring `notifyAuthAnomaly`), Task 4 (per-recipient cap). WP-SU-9's two → Tasks 5-8 (atomic decision, all six routes) and Task 9 (`reset/confirm`). WP-SU-10 → Task 10, which also closes the `request_path` leak that wiring the hook introduces. Part 4 covers the deployment. `WP-OBS-1` (cron `maxRuntime` vs `maxDuration`) is **out of scope** — it is a separate queued WP and is not touched here.

**Type consistency.** `reserve` returns `Promise<string>` and `settle` takes that string in all six routes and both test files. `evaluateSignupSurge(priorCount, ceiling, surgeThreshold)` has the same argument order in the test, the implementation and the route. `kindCount(kind, now, windowMs)` matches at all three call sites. `SurgeVerdict` is `{blocked, alert}` throughout.

**Known ordering coupling.** Task 3 (SU-8's global count) and Task 6 (SU-9's reserve) both edit the same region of the signup route; Task 6 says explicitly where the reservation goes relative to the global block. If the WPs are ever reordered, that instruction must be re-read.
