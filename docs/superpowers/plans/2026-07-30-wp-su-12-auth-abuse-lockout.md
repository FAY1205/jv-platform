# WP-SU-12: Auth Abuse Hardening — Decouple Code-Request from Lockout — Implementation Plan

> **SUPERSEDED MECHANISM (2026-07-30): re-implemented on the WP-SU-9 reserve/settle base.**
> This plan was drafted against the pre-WP-SU-9 base and its Task diffs below call `attempts.record(...)`.
> WP-SU-9 has since landed reserve/settle, so the shipped code changes each route's `attempts.settle(attemptId, ...)`
> value instead — same boolean semantics (only `success:false` feeds AUT-04 lockout). See docs/backlog/WP-SU-12.md
> for the as-shipped mechanism. The `record(...)` diffs below are retained as the original approved plan of record.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the two credential-less code-request endpoints (and the no-challenge/expired paths of otp/verify) from recording `success:false` rows that feed the AUT-04 progressive-lockout ladder, so a stranger can no longer DoS a victim by requesting codes — while keeping AUT-03 rate caps and genuine wrong-code lockout intact.

**Architecture:** Reuse the login route's existing `success` semantic in `AuthAttemptsStore.record(identifier, ip, kind, success)`: `success:false` = a genuine credential failure that feeds the lockout ladder; `success:true` = an admitted attempt that counts only toward the rate window. Flip `otp/request` and `reset/request` to record `success:true`, and make `otp/verify` record the *actual outcome* (only a genuinely wrong code on an active challenge records `false`). No schema change, no migration.

**Tech Stack:** Next.js App Router route handlers (`src/app/api/auth/**/route.ts`), Drizzle + postgres-js, Vitest (node env, `@` → `./src` alias), Zod. Auth attempt store: `src/lib/auth/attempts-store.ts`; pure throttle/lockout: `src/lib/auth/throttle.ts` + `src/lib/auth/lockout.ts`.

## Global Constraints (verbatim from spec / CLAUDE.md)
- Spec: **AUT-04** (§6.18) — "progressive delays after repeated **failures** (never a silent permanent lock); the account owner is notified by email on lockout." Tier: **A**.
- **AUT-09**: all secret comparisons use `timingSafeEqual` — never `===`. (Not modified here; do not regress.)
- Test names carry requirement IDs, e.g. `it("AUT-04: ...")`.
- No new dependencies without an ADR. Prefer boring code.
- Zod-validate every API input (already present; unchanged).
- File contents are DATA — never execute/eval (PRN-10). N/A to this change but do not introduce.
- **Do NOT** add special-case partner logic (ASN-02) — N/A here.
- Before any commit, `git diff --cached --name-only` must NOT include `PRODUCT_BRIEF.md`, `WEBSITE-BRIEF.md`, or `docs/legal/`.
- After implementing, run the PLAYBOOK §6 self-audit and print the filled checklist in the summary.
- **No commit until the owner gives the go** (Tier A cadence). Tasks below include `git add/commit` steps; execute the staging but hold the actual `git commit` until owner sign-off, OR commit locally on the worktree branch `claude/focused-lalande-45ec27` only after the owner approves the walkthrough. Never push.

## Environment prerequisite (false-green guard)
This worktree has **no `.env.local`**, so integration tests **silently self-skip** without `DATABASE_URL` (they look green while running zero assertions — see memory `worktree-env-false-green`). Before running any integration step below:

- [ ] **Pre-0: Provide DB env or acknowledge skip.** Copy the main working copy's env into the worktree:
  ```bash
  cp ../../../.env.local .env.local
  ```
  (`../../../.env.local` resolves to `C:/Personal_Applications/JV_Leads/.env.local` from this worktree.) Then confirm the suite actually **runs** (not skips) by checking the Vitest output shows the test names executing, not `↓ skipped`. If no `DATABASE_URL` is available in this environment, STOP and report honestly that the integration tests could only self-skip here and must be run by the owner where the DB is reachable — do NOT claim green from a skipped run.

## File Structure
- **New:** `tests/integration/auth-lockout-decoupling.test.ts` — route-level integration proof that code requests never feed lockout, wrong codes still do. Self-skips without `DATABASE_URL`.
- **Modify:** `src/app/api/auth/otp/request/route.ts` — one line (record `true`).
- **Modify:** `src/app/api/auth/reset/request/route.ts` — one line (record `true`).
- **Modify:** `src/app/api/auth/otp/verify/route.ts` — outcome-accurate recording (remove the unconditional `false`; record once per path with the correct flag).
- **Unchanged reference:** `src/app/api/auth/login/route.ts` (already correct — do not touch).

---

### Task 1: Decouple otp/request + reset/request from the lockout ladder

**Files:**
- Create: `tests/integration/auth-lockout-decoupling.test.ts`
- Modify: `src/app/api/auth/otp/request/route.ts:47`
- Modify: `src/app/api/auth/reset/request/route.ts:53`

**Interfaces:**
- Consumes: `AuthAttemptsStore` (`src/lib/auth/attempts-store.ts`) — `record(identifier: string, ip: string|null, kind: string, success: boolean): Promise<void>`, `snapshot(identifier, ip, kind, now, cfg): Promise<{attempts:number[]; ipAttempts:number[]; failures:number[]}>`. `evaluateThrottle(snap, now, cfg): {ok:boolean; retryAfterSec:number; reason?: "rate_limited"|"locked_out"}` and configs `OTP_THROTTLE`, `RESET_THROTTLE` from `src/lib/auth/throttle.ts`.
- Consumes: route handlers `POST(request: Request): Promise<Response>` from `@/app/api/auth/otp/request/route` and `@/app/api/auth/reset/request/route`.
- Produces: nothing new — behavior change only.

- [ ] **Step 1: Write the failing tests** (create `tests/integration/auth-lockout-decoupling.test.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, OTP_THROTTLE, RESET_THROTTLE } from "@/lib/auth/throttle";
import { POST as otpRequest } from "@/app/api/auth/otp/request/route";
import { POST as resetRequest } from "@/app/api/auth/reset/request/route";

// WP-SU-12 / AUT-04 (live): a code REQUEST is not a credential failure and must
// never feed the progressive-lockout ladder — otherwise a stranger could DoS a
// victim by requesting codes for their email. Rate caps (AUT-03) still apply.
// Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const ORIGIN = "http://localhost";
function post(path: string, body: unknown): Request {
  // requireToken:false routes need only an Origin matching the request URL's origin.
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

suite("AUT-04: code requests are decoupled from the lockout ladder", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let store: AuthAttemptsStore;

  beforeAll(() => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    store = new AuthAttemptsStore(db);
  });

  afterAll(async () => {
    await client.end();
  });

  async function cleanup(identifier: string) {
    await db
      .delete(schema.authAttempts)
      .where(eq(schema.authAttempts.identifier, identifier.toLowerCase()));
  }

  it("AUT-04: repeated OTP requests by a stranger never lock the victim", async () => {
    const victim = `otp-req-${randomUUID()}@wp-su-12.test`;
    for (let i = 0; i < 5; i++) {
      const res = await otpRequest(post("/api/auth/otp/request", { email: victim }));
      expect(res.status).toBe(200); // uniform accept — never a lockout 429
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "otp", now, OTP_THROTTLE);
    expect(snap.failures.length).toBe(0); // no lockout-feeding rows
    expect(evaluateThrottle(snap, now, OTP_THROTTLE).reason).not.toBe("locked_out");
    await cleanup(victim);
  });

  it("AUT-04: repeated reset requests by a stranger never lock the victim", async () => {
    const victim = `reset-req-${randomUUID()}@wp-su-12.test`;
    for (let i = 0; i < 5; i++) {
      const res = await resetRequest(post("/api/auth/reset/request", { email: victim }));
      expect(res.status).toBe(200);
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "reset", now, RESET_THROTTLE);
    expect(snap.failures.length).toBe(0);
    expect(evaluateThrottle(snap, now, RESET_THROTTLE).reason).not.toBe("locked_out");
    await cleanup(victim);
  });

  it("AUT-04: OTP requests still count toward the rate window (flood cap intact)", async () => {
    const victim = `otp-rate-${randomUUID()}@wp-su-12.test`;
    for (let i = 0; i < 5; i++) {
      await otpRequest(post("/api/auth/otp/request", { email: victim }));
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "otp", now, OTP_THROTTLE);
    expect(snap.attempts.length).toBe(5); // every request is still recorded (rate)
    await cleanup(victim);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/auth-lockout-decoupling.test.ts`
Expected: the two "never lock the victim" tests **FAIL** — with the current code recording `success:false`, `snap.failures.length` is `5` and `evaluateThrottle(...).reason` is `"locked_out"`. The rate test passes. (If the whole suite reports **skipped**, `DATABASE_URL` is missing — go back to Pre-0; a skip is NOT a pass.)

- [ ] **Step 3: Fix `otp/request`** — `src/app/api/auth/otp/request/route.ts`, replace the record line inside `withUniformTiming` (currently `await attempts.record(email, ip, KIND, false);`):

```ts
      // AUT-04 (WP-SU-12): a code REQUEST is not a credential failure. Record
      // success:true so it counts toward the AUT-03 rate cap but never feeds the
      // lockout ladder — otherwise a stranger could lock a victim by requesting codes.
      await attempts.record(email, ip, KIND, true);
```

- [ ] **Step 4: Fix `reset/request`** — `src/app/api/auth/reset/request/route.ts`, replace the record line inside `withUniformTiming` (currently `await attempts.record(email, ip, KIND, false);`):

```ts
      // AUT-04 (WP-SU-12): a reset REQUEST is not a credential failure. Record
      // success:true so it counts toward the AUT-03 rate cap but never feeds the
      // lockout ladder.
      await attempts.record(email, ip, KIND, true);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/auth-lockout-decoupling.test.ts`
Expected: all three tests **PASS** (not skipped).

- [ ] **Step 6: Guard — confirm no existing test asserted the old failure behavior**

Run: `git grep -nE "otp/request|reset/request" tests/ | grep -iE "lock|fail"`
Expected: no hits that assert a request produces a lockout/failure. If any exist, update them to the new semantic and re-run their file.

- [ ] **Step 7: Stage (hold commit for owner go)**

```bash
git add tests/integration/auth-lockout-decoupling.test.ts src/app/api/auth/otp/request/route.ts src/app/api/auth/reset/request/route.ts
git diff --cached --name-only   # verify: no PRODUCT_BRIEF.md / WEBSITE-BRIEF.md / docs/legal/
```
Commit message (run only after owner go): `WP-SU-12: code requests no longer feed AUT-04 lockout (otp/request, reset/request)`

---

### Task 2: Make otp/verify record the actual outcome

**Files:**
- Modify: `src/app/api/auth/otp/verify/route.ts:51-62`
- Modify (append tests): `tests/integration/auth-lockout-decoupling.test.ts`

**Interfaces:**
- Consumes: `OtpStore` (`src/lib/auth/otp-store.ts`) — `persist(identifier: string, challenge: OtpChallenge): Promise<void>`; `issueOtp(pepper: string, now: number): { code: string; challenge: OtpChallenge }` from `src/lib/auth/otp.ts`.
- Consumes: `otpOutcome(...)` returns `OtpOutcome = "ok" | "expired" | "wrong" | "too_many" | "consumed"`. Only `"wrong"` is a credential failure.
- Produces: nothing new.

- [ ] **Step 1: Write the failing/guard tests** — append inside the `suite(...)` block in `tests/integration/auth-lockout-decoupling.test.ts`. First add these imports at the top of the file (next to the others):

```ts
import { randomBytes } from "node:crypto";
import { issueOtp } from "@/lib/auth/otp";
import { OtpStore } from "@/lib/auth/otp-store";
import { POST as otpVerify } from "@/app/api/auth/otp/verify/route";
```

Then append these two tests before the closing `});` of the suite (extend `cleanup` usage to also clear challenges):

```ts
  async function cleanupChallenges(identifier: string) {
    await db
      .delete(schema.otpChallenges)
      .where(eq(schema.otpChallenges.identifier, identifier.toLowerCase()));
  }

  it("AUT-04: a verify with no active challenge does not feed lockout", async () => {
    const victim = `otp-noverify-${randomUUID()}@wp-su-12.test`;
    for (let i = 0; i < 5; i++) {
      const res = await otpVerify(post("/api/auth/otp/verify", { email: victim, code: "000000" }));
      expect(res.status).toBe(400); // uniform invalid — no code was ever issued
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "otp", now, OTP_THROTTLE);
    expect(snap.failures.length).toBe(0); // must NOT feed lockout
    expect(evaluateThrottle(snap, now, OTP_THROTTLE).reason).not.toBe("locked_out");
    await cleanup(victim);
  });

  it("AUT-04: a genuinely wrong OTP code still feeds lockout (brute-force protection)", async () => {
    const victim = `otp-wrong-${randomUUID()}@wp-su-12.test`;
    const now0 = Date.now();
    const pepper = randomBytes(16).toString("base64url");
    const { code, challenge } = issueOtp(pepper, now0);
    await new OtpStore(db).persist(victim, challenge);
    const wrong = code === "000000" ? "111111" : "000000"; // guaranteed != real code

    for (let i = 0; i < 5; i++) {
      const res = await otpVerify(post("/api/auth/otp/verify", { email: victim, code: wrong }));
      expect(res.status).toBe(400);
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "otp", now, OTP_THROTTLE);
    expect(snap.failures.length).toBe(5); // wrong guesses DO feed lockout
    expect(evaluateThrottle(snap, now, OTP_THROTTLE).reason).toBe("locked_out");
    await cleanupChallenges(victim);
    await cleanup(victim);
  });
```

- [ ] **Step 2: Run to verify the no-challenge test fails, wrong-code test passes**

Run: `npx vitest run tests/integration/auth-lockout-decoupling.test.ts -t "AUT-04: a verify with no active challenge"`
Expected: **FAIL** — current code records `success:false` at line 51 before the challenge check, so `failures.length` is `5` and the account is `locked_out`.

Run: `npx vitest run tests/integration/auth-lockout-decoupling.test.ts -t "genuinely wrong OTP code"`
Expected: **PASS** — this is a regression guard; wrong codes already feed lockout today and must continue to after the fix.

- [ ] **Step 3: Fix `otp/verify`** — `src/app/api/auth/otp/verify/route.ts`. Replace the block that currently reads:

```ts
  await attempts.record(email, ip, KIND, false);

  const store = new OtpStore(db);
  const challenge = await store.latestActive(email);
  if (!challenge) return jsonError(INVALID.code, INVALID.message, 400);

  const outcome = otpOutcome(challenge, code, now, MAX_ATTEMPTS);
  if (outcome !== "ok") {
    if (outcome === "wrong") await store.incrementAttempt(challenge.id);
    else if (outcome === "too_many" || outcome === "expired") await store.consume(challenge.id, now);
    return jsonError(INVALID.code, INVALID.message, 400);
  }
```

with (note: the unconditional `record(...,false)` is removed; each path records exactly once with the correct flag):

```ts
  const store = new OtpStore(db);
  const challenge = await store.latestActive(email);
  if (!challenge) {
    // No code was ever issued: an admitted attempt (counts toward the AUT-03 rate
    // cap) but NOT a credential failure — record success:true so a stranger can't
    // lock a victim by verifying against a non-existent code (AUT-04 / WP-SU-12).
    await attempts.record(email, ip, KIND, true);
    return jsonError(INVALID.code, INVALID.message, 400);
  }

  const outcome = otpOutcome(challenge, code, now, MAX_ATTEMPTS);
  if (outcome !== "ok") {
    // AUT-04 (WP-SU-12): ONLY a genuinely wrong code is a credential failure that
    // feeds the lockout ladder (record success:false). expired/too_many/consumed are
    // recorded success:true — they count toward the rate cap only, never lockout.
    await attempts.record(email, ip, KIND, outcome !== "wrong");
    if (outcome === "wrong") await store.incrementAttempt(challenge.id);
    else if (outcome === "too_many" || outcome === "expired") await store.consume(challenge.id, now);
    return jsonError(INVALID.code, INVALID.message, 400);
  }

  // Correct code: record the successful verification (not a failure) before we try to
  // establish the session, matching the login route's success:true semantics. Keeps
  // exactly one recorded attempt per admitted request (rate window preserved).
  await attempts.record(email, ip, KIND, true);
```

Leave everything from `if (!(await establishSessionForEmail(email))) {` onward unchanged.

- [ ] **Step 4: Run the full file to verify all pass**

Run: `npx vitest run tests/integration/auth-lockout-decoupling.test.ts`
Expected: all five tests **PASS** (not skipped). The no-challenge test now records `success:true` (0 failures); the wrong-code guard still records 5 failures and locks out.

- [ ] **Step 5: Run the existing auth suites to confirm no regression**

Run: `npx vitest run tests/integration/auth-otp.test.ts tests/integration/auth-reset.test.ts tests/integration/auth-throttle.test.ts tests/unit/auth-otp-verify.test.ts tests/unit/auth-lockout-gate.test.ts tests/unit/auth-throttle.test.ts`
Expected: all **PASS** (integration self-skips only if no `DATABASE_URL`). The pure `otpOutcome` is unchanged, so unit tests are unaffected.

- [ ] **Step 6: Stage (hold commit for owner go)**

```bash
git add src/app/api/auth/otp/verify/route.ts tests/integration/auth-lockout-decoupling.test.ts
git diff --cached --name-only   # verify no forbidden files
```
Commit message (run only after owner go): `WP-SU-12: otp/verify records real outcome — only a wrong code feeds AUT-04 lockout`

---

### Task 3: Gate — self-audit, reviews, owner walkthrough

**Files:** none (verification + docs only).

- [ ] **Step 1: Full-suite sanity + typecheck/lint**

Run: `npx vitest run` then `npx tsc --noEmit` and `npm run lint` (if present in package.json scripts).
Expected: green (integration self-skips without DB — note that explicitly in the summary; do not claim green from skips).

- [ ] **Step 2: Fill the PLAYBOOK §6 self-audit checklist** and paste it into the final summary. Explicitly assert: no schema change; AUT-03 rate caps unchanged (verified via the rate test); AUT-09 timing-safe paths untouched; PRN-08 scope N/A (pre-session routes); no forbidden files staged.

- [ ] **Step 3: Update `docs/backlog/WP-SU-12.md`** — tick the Definition-of-done boxes that are now satisfied.

- [ ] **Step 4: Reviews** — run `pr-reviewer` and `audit-security` over the diff (`git diff` of the three routes + new test file). Address any Tier-A findings before the walkthrough.

- [ ] **Step 5: Owner walkthrough** — present the diff, the red→green evidence, and the self-audit. **Only after the owner says go:** run the two commit commands from Task 1 Step 7 and Task 2 Step 6 on branch `claude/focused-lalande-45ec27`, then open a PR into `phase-2/distribution`. Do not push before owner go.

---

## Self-Review (performed while writing this plan)
- **Spec coverage:** otp/request → Task 1; reset/request → Task 1; otp/verify → Task 2; AUT-03 rate cap preserved → Task 1 rate test; wrong-code lockout preserved → Task 2 guard; reviews/self-audit/owner-walkthrough → Task 3. login left unchanged (reference). Out-of-scope items (OTP/reset notify gap, signup audit) intentionally not tasked.
- **Placeholder scan:** none — every code and command step is concrete.
- **Type consistency:** `record(identifier, ip, kind, success)`, `snapshot(...).failures/.attempts`, `evaluateThrottle(...).reason`, `OtpOutcome` union, `issueOtp` / `OtpStore.persist` signatures all match the current source. `record(..., outcome !== "wrong")` records `false` (feeds lockout) exactly when the code is wrong — verified against `success:false` = failure semantics.
