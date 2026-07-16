# Public Self-Serve Signup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new customer sign up publicly, get their own isolated tenant + admin account, verify their email, and log in — with CAPTCHA, rate-limiting, and enumeration safety.

**Architecture:** App-owned signup (design Approach A). A custom `/api/auth/signup` endpoint validates a Turnstile CAPTCHA, creates a Supabase auth user (`email_confirm:false`), transactionally provisions a `tenants` + `users` row (compensating-delete on failure), and emails a verification link through the existing SEC-07-sinked Resend transport. A verify endpoint flips `email_confirm:true`. Tenant isolation is automatic via the existing `scope.ts` (`app_metadata.tenant_id`).

**Tech Stack:** Next.js App Router, Supabase Auth (admin API), Drizzle + Postgres, Zod, Cloudflare Turnstile (script tag + `siteverify` fetch, no npm dep), existing auth primitives (`ResetStore`, `AuthAttemptsStore`, `withUniformTiming`, `timingSafeEqualStr`).

**Governing docs:** design spec `docs/superpowers/specs/2026-07-16-self-serve-signup-design.md`; ADR-0033 (self-signup, supersedes SCP-02 admin clause); ADR-0034 (Turnstile).

## Global Constraints

- **Tier A** — auth, schema/RLS, tenancy, new subprocessor. Owner-gated; reviews before commit: pr-reviewer + audit-security + audit-tenancy + audit-compliance.
- **PRN-08:** every query goes through `lib/scope.ts`; never the service role without a tenant filter. The only cross-tenant operation allowed is provisioning a brand-new tenant (a system op, like the cron tenant-list).
- **AUT-05:** auth endpoints return uniform messages and timing whether or not the account exists.
- **AUT-09:** all secret/token comparisons use `timingSafeEqualStr`, never `===`.
- **SEC-05:** never log passwords, tokens, OTPs, or the new user's raw email in a way that violates the contract. `logError` reaches Sentry (ADR-0032) — pass identifiers/codes only.
- **SEC-07:** non-production never emails a real recipient — the verification email uses the app's Resend transport, which sinks in non-prod.
- **Zod-validate every input; uniform `{code,message,traceId}` envelope** (`src/lib/http.ts`).
- **Every schema change = migration + seed + RLS policy + index in the same PR.** Migrations via drizzle-kit: `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs …`.
- **Test naming carries requirement IDs:** `it("SCP-02: ...")`, `it("AUT-05: ...")`.
- **Test running (learned the hard way):** vitest SERIAL — `pnpm test:unit -- --no-file-parallelism`; integration `npx vitest run tests/integration/<file> --no-file-parallelism`; integration self-skips silently without `DATABASE_URL` in `.env.local` — read the counts. Component tests need `// @vitest-environment jsdom` on line 1.
- **No new npm dependency** (Turnstile is a script tag + fetch). Any surprise dep needs a new ADR.
- **PRN-12:** no hardcoded hex/font/product name in components — semantic tokens only.

---

### Task 1: Turnstile env vars + production fail-fast

**Files:**
- Modify: `src/lib/env.ts` (add two vars + a production refine)
- Modify: `tests/unit/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `env.TURNSTILE_SITE_KEY: string | undefined`, `env.TURNSTILE_SECRET_KEY: string | undefined`. Production boot throws if `TURNSTILE_SECRET_KEY` is unset (ADR-0034).

- [ ] **Step 1: Write the failing test** — add to the production block in `tests/unit/env.test.ts`. The `PROD` fixture there must gain `TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"`; add:

```ts
it("ADR-0034: refuses to boot in production without TURNSTILE_SECRET_KEY (public signup needs bot protection)", () => {
  expect(() => readEnv({ ...PROD, TURNSTILE_SECRET_KEY: undefined })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/unit/env.test.ts --no-file-parallelism`. Expected: FAIL (does not throw) plus the existing prod tests now fail because `PROD` lacks the key — that's expected until Step 3 adds it to the fixture and schema.

- [ ] **Step 3: Implement** — in `src/lib/env.ts`, inside `EnvSchema`, add near `SENTRY_DSN`:

```ts
  // ADR-0034: Cloudflare Turnstile — signup bot protection. SITE_KEY is public (client
  // widget); SECRET_KEY is server-only and required in production (refine below).
  TURNSTILE_SITE_KEY: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,
```

Add a refine after the EMAIL_FROM refine:

```ts
).refine(
  // ADR-0034: public signup must never ship without server-side CAPTCHA verification.
  (v) => v.APP_ENV !== "production" || !!v.TURNSTILE_SECRET_KEY,
  { message: "TURNSTILE_SECRET_KEY is required in production (signup bot protection).", path: ["TURNSTILE_SECRET_KEY"] },
);
```

Add `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` to the `PROD` fixture in the test. Add both to `.env.example` under a new `# CAPTCHA (Cloudflare Turnstile, ADR-0034)` heading with the note that the secret is required in production and dev may use Turnstile's test keys (`1x00000000000000000000AA` site / `1x0000000000000000000000000000000AA` secret).

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run tests/unit/env.test.ts --no-file-parallelism`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/env.ts tests/unit/env.test.ts .env.example && git commit -m "feat(signup): Turnstile env vars + production fail-fast (ADR-0034)"`

---

### Task 2: Turnstile server verification

**Files:**
- Create: `src/lib/auth/turnstile.ts`
- Create: `tests/unit/turnstile.test.ts`

**Interfaces:**
- Produces: `async function verifyTurnstile(token: string | undefined, secret: string | undefined, remoteIp?: string): Promise<boolean>` — POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify`; returns `false` on missing token/secret, non-2xx, `success:false`, or any network error (fail closed). Never logs the secret.

- [ ] **Step 1: Write the failing test** — `tests/unit/turnstile.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyTurnstile } from "@/lib/auth/turnstile";

afterEach(() => vi.unstubAllGlobals());

describe("ADR-0034: Turnstile verification (fail closed)", () => {
  it("returns false when the token is missing without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyTurnstile(undefined, "secret")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns true only when siteverify reports success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
    expect(await verifyTurnstile("tok", "secret")).toBe(true);
  });

  it("returns false on success:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: false }) })));
    expect(await verifyTurnstile("tok", "secret")).toBe(false);
  });

  it("returns false (fail closed) on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await verifyTurnstile("tok", "secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/unit/turnstile.test.ts --no-file-parallelism`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/lib/auth/turnstile.ts`:

```ts
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// ADR-0034: verify a Turnstile token server-side. Fail closed — any missing input,
// non-2xx, success:false, or network error returns false. The secret is never logged.
export async function verifyTurnstile(
  token: string | undefined,
  secret: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(SITEVERIFY, { method: "POST", body });
    if (!res.ok) return false;
    const json = (await res.json().catch(() => ({}))) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run tests/unit/turnstile.test.ts --no-file-parallelism`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit** — `git add src/lib/auth/turnstile.ts tests/unit/turnstile.test.ts && git commit -m "feat(signup): Turnstile server verification, fail-closed (ADR-0034)"`

---

### Task 3: Signup verification token store (schema + store)

**Files:**
- Create: migration under `src/db/migrations/` (via drizzle-kit generate)
- Modify: `src/db/schema.ts` (add `signupVerifications` table)
- Create: `src/lib/auth/signup-token.ts` (issue/verify, mirrors `reset-token.ts`)
- Create: `src/lib/auth/signup-store.ts` (persist/consume, mirrors `reset-store.ts`)
- Create: `tests/integration/signup-store.test.ts`

**Interfaces:**
- Produces: `issueSignupToken(pepper, userId, now, ttlMs?)` → `{ token, record }` (token is the raw secret e-mailed; record holds only the hash + `userId` + `expiresAt`). `class SignupStore { persist(record); consume(rawToken, now): Promise<{ userId } | null> }` — constant-time hash match, single-use (marks consumed), rejects expired.

**Reference:** copy the exact shape of `src/lib/auth/reset-token.ts` + `src/lib/auth/reset-store.ts`; the only differences are the table name and that the payload is `userId` (the Supabase auth id to confirm) rather than a reset target. Read those two files first and mirror them.

- [ ] **Step 1: Write the failing test** — `tests/integration/signup-store.test.ts` (needs `DATABASE_URL`; mirror `tests/integration/auth-reset.test.ts`):

```ts
// verifies: persist then consume returns the userId once; second consume returns null
// (single-use); a wrong token returns null; an expired token returns null.
```

Write the four cases in full, following `auth-reset.test.ts`'s structure (real DB, `getDb()`, insert via store, assert via consume).

- [ ] **Step 2: Add the table to `src/db/schema.ts`:**

```ts
export const signupVerifications = pgTable(
  "signup_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(), // the Supabase auth user id to confirm
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("signup_verifications_token_hash_idx").on(t.tokenHash),
    index("signup_verifications_user_idx").on(t.userId),
  ],
);
```

- [ ] **Step 3: Generate + apply the migration**

Run: `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs generate` then `… migrate`. Add an RLS policy consistent with the other auth-token tables (service-role-only; this table is never read through `scope.ts`). Expected: new SQL file created and applied.

- [ ] **Step 4: Implement `signup-token.ts` + `signup-store.ts`** mirroring the reset equivalents (hash with the same helper, `timingSafeEqualStr` on lookup, mark `consumedAt`).

- [ ] **Step 5: Run tests to verify they pass** — `npx vitest run tests/integration/signup-store.test.ts --no-file-parallelism`. Expected: PASS (4 tests, not skipped — confirm `DATABASE_URL` is set).

- [ ] **Step 6: Commit** — `git add src/db/schema.ts src/db/migrations src/lib/auth/signup-token.ts src/lib/auth/signup-store.ts tests/integration/signup-store.test.ts && git commit -m "feat(signup): hashed single-use email-verification token store"`

---

### Task 4: Signup emails (verify link + already-registered notice)

**Files:**
- Modify: `src/lib/auth/notify.ts` (add `buildSignupVerifyEmail`, `buildAlreadyRegisteredEmail`, `notifySignupVerify`, `notifyAlreadyRegistered`)
- Modify: `tests/unit/auth-email.test.ts`

**Interfaces:**
- Produces: `notifySignupVerify(email, link): Promise<void>` and `notifyAlreadyRegistered(email): Promise<void>` — both best-effort (try/catch → `logError`), routed through the same `transport()` (Resend in prod, sink in non-prod). Builders return `EmailMessage` with `meta.kind` `"signup_verify"` / `"already_registered"`.

- [ ] **Step 1: Write the failing test** — in `tests/unit/auth-email.test.ts`, mirror the existing builder tests:

```ts
it("signup verify: html + text both carry the link", () => {
  const m = buildSignupVerifyEmail("new@x.test", "https://app.test/signup/verify?token=abc");
  expect(m.html).toContain("https://app.test/signup/verify?token=abc");
  expect(m.text).toContain("https://app.test/signup/verify?token=abc");
  expect(m.meta?.kind).toBe("signup_verify");
});

it("already-registered: names no password/token, just points to login", () => {
  const m = buildAlreadyRegisteredEmail("dupe@x.test");
  expect(m.text.toLowerCase()).toContain("log in");
  expect(m.meta?.kind).toBe("already_registered");
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/unit/auth-email.test.ts --no-file-parallelism`. Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement** — add the two builders using the existing `authNotice(...)` helper (CTA button for verify; a login link for already-registered), and the two `notify*` wrappers mirroring `notifyReset`/`notifyInvite` exactly (same try/catch + `logError("notify_signup_verify_failed", …)`).

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run tests/unit/auth-email.test.ts --no-file-parallelism`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/auth/notify.ts tests/unit/auth-email.test.ts && git commit -m "feat(signup): verification + already-registered emails"`

---

### Task 5: Tenant + admin provisioning (compensating saga)

**Files:**
- Create: `src/lib/auth/provision-signup.ts`
- Create: `tests/integration/provision-signup.test.ts`
- Reference: `src/lib/auth/provision.ts` (existing `admin.createUser` pattern), `src/db/schema.ts`

**Interfaces:**
- Produces: `async function provisionSignup(admin: SupabaseClient, db: DB, input: { email; password; workspaceName }): Promise<{ userId: string; tenantId: string }>` — creates the Supabase auth user (`email_confirm:false`, `app_metadata:{tenant_id, role:"admin"}`), then inserts `tenants` + `users` in one transaction; on DB failure calls `admin.deleteUser(userId)` and rethrows. `slug` derived from `workspaceName` with a uniqueness suffix on collision.

- [ ] **Step 1: Write the failing test** — `tests/integration/provision-signup.test.ts`:

```ts
// SCP-02: provisionSignup creates exactly one tenant + one admin user, ids consistent,
//         auth user email_confirm=false.
// SCP-02: a forced DB failure (e.g. duplicate) deletes the auth user — no orphan
//         (assert findAuthUserByEmail returns null afterward).
```

Write both cases fully; use a mock/stub Supabase admin that records `createUser`/`deleteUser` calls, real `db`.

- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `provisionSignup` — pre-generate `tenantId = crypto.randomUUID()`; `createUser({ email, password, email_confirm:false, app_metadata:{ tenant_id: tenantId, role:"admin" } })`; `try { await db.transaction(tx => { insert tenants{id:tenantId,name,slug}; insert users{id:userId,tenantId,email,role:"admin"} }) } catch (e) { await admin.deleteUser(userId); throw e }`. Slug: `slugify(workspaceName)` + short random suffix on unique-violation retry (bounded retries).

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run tests/integration/provision-signup.test.ts --no-file-parallelism`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/auth/provision-signup.ts tests/integration/provision-signup.test.ts && git commit -m "feat(signup): atomic tenant+admin provisioning with orphan compensation"`

---

### Task 6: Signup endpoint

**Files:**
- Create: `src/app/api/auth/signup/route.ts`
- Create: `tests/integration/signup-route.test.ts`
- Reference: `src/app/api/auth/reset/request/route.ts` (rate-limit + uniform-timing + enumeration pattern), `src/app/api/auth/login/route.ts`

**Interfaces:**
- Consumes: `verifyTurnstile` (T2), `SignupStore`/`issueSignupToken` (T3), `notifySignupVerify`/`notifyAlreadyRegistered` (T4), `provisionSignup` (T5).
- Produces: `POST` returning uniform envelope. Success (new or existing email): 200 `{code:"signup_check_email"}`. CAPTCHA fail: 400. Rate-limited: 429 + `Retry-After`.

- [ ] **Step 1: Write the failing test** — `tests/integration/signup-route.test.ts` covering: (a) AUT-05 new-email and existing-email return the identical 200 envelope and no second account is created for the existing email; (b) missing/invalid CAPTCHA → 400 and no provisioning; (c) rate-limit → 429; (d) a successful signup writes the tenant+user and enqueues a sink'd verification email. Stub `verifyTurnstile` and the email transport; use real DB. Write all cases in full.

- [ ] **Step 2: Run test to verify it fails** — Expected: FAIL (route missing).

- [ ] **Step 3: Implement** the handler in this order (mirror `reset/request`): `assertCsrf({requireToken:false})` → Zod parse (`email`, `password` via zxcvbn floor, `workspaceName`, `captchaToken`) → throttle snapshot (`signup` kind) → `verifyTurnstile(captchaToken, env.TURNSTILE_SECRET_KEY, clientIp)` else 400 → wrap the rest in `withUniformTiming(MIN_RESPONSE_MS, async () => { if (emailExists) { await notifyAlreadyRegistered(email); return; } const {userId} = await provisionSignup(...); const {token, record} = issueSignupToken(...); await new SignupStore(db).persist(record); await notifySignupVerify(email, `${origin}/signup/verify?token=${token}`); })` → record attempt → return the uniform 200.

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run tests/integration/signup-route.test.ts --no-file-parallelism`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/app/api/auth/signup/route.ts tests/integration/signup-route.test.ts && git commit -m "feat(signup): public signup endpoint (captcha, rate-limit, enumeration-safe)"`

---

### Task 7: Verify endpoint

**Files:**
- Create: `src/app/api/auth/signup/verify/route.ts`
- Create: `tests/integration/signup-verify-route.test.ts`

**Interfaces:**
- Consumes: `SignupStore.consume` (T3), Supabase admin `updateUserById`.
- Produces: `POST` `{token}` → 200 on success (auth user `email_confirm` flipped true), uniform 400 on expired/used/unknown.

- [ ] **Step 1: Write the failing test** — cases: valid token confirms the user and is single-use (second call 400); expired/unknown token → 400; user cannot `signInWithPassword` before verify and can after. Write fully.

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (route missing).

- [ ] **Step 3: Implement** — Zod parse token → `const res = await new SignupStore(db).consume(token, Date.now())` → if null, uniform 400 → `await admin.auth.admin.updateUserById(res.userId, { email_confirm: true })` → 200. All comparisons constant-time (inside the store).

- [ ] **Step 4: Run to verify passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/app/api/auth/signup/verify/route.ts tests/integration/signup-verify-route.test.ts && git commit -m "feat(signup): email-verification endpoint activates login"`

---

### Task 8: Signup page UI

**Files:**
- Create: `src/app/signup/page.tsx`
- Create: `tests/unit/signup-page.test.tsx` (`// @vitest-environment jsdom` line 1)
- Reference: `src/app/login/page.tsx`, `src/app/forgot/page.tsx` (form + states pattern), the password-strength component

**Interfaces:**
- Consumes: `POST /api/auth/signup`. Loads the Turnstile script and renders the widget; passes the token to the request.

- [ ] **Step 1: Write the failing test** — assert the form renders email/password/workspace fields and the submit button; submitting without a CAPTCHA token disables submit or shows the required state; a mocked 200 shows the "check your email" success state. Mirror `login/page.tsx`'s test if one exists; otherwise test the component's rendered states.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/signup-page.test.tsx --no-file-parallelism`. Expected: FAIL.

- [ ] **Step 3: Implement** — a client component built from `src/components` (Card, Input, Button, the strength meter), every interactive state (default/hover/focus-visible/active/disabled/loading), semantic tokens only (PRN-12). Load Turnstile via `next/script` (`https://challenges.cloudflare.com/turnstile/v0/api.js`) rendering the widget with `env.NEXT_PUBLIC_TURNSTILE_SITE_KEY`; on solve, store the token; on submit POST the form + token; render loading/success/error from the uniform envelope. Add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` wiring (public var) as needed.

- [ ] **Step 4: Run to verify passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/app/signup tests/unit/signup-page.test.tsx && git commit -m "feat(signup): public signup page with Turnstile widget"`

---

### Task 9: Verify landing page

**Files:**
- Create: `src/app/signup/verify/page.tsx`
- Reference: `src/app/reset/page.tsx` (token-from-query landing pattern)

**Interfaces:**
- Consumes: `POST /api/auth/signup/verify`. Reads `?token=` (client), presents a confirm action, POSTs it.

- [ ] **Step 1: Write the failing test** — `tests/unit/signup-verify-page.test.tsx` (jsdom): renders a confirm button; a mocked 200 shows success + a link to `/login`; a mocked 400 shows the expired/invalid state. Write fully.

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL.

- [ ] **Step 3: Implement** — mirror `reset/page.tsx`: read the token from the query (never render it), confirm-button POSTs to the verify endpoint, render loading/success/error/expired. On success, link to `/login`.

- [ ] **Step 4: Run to verify passes** — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/app/signup/verify tests/unit/signup-verify-page.test.tsx && git commit -m "feat(signup): verification landing page"`

---

### Task 10: Tenant-isolation integration test + full-suite gate

**Files:**
- Create: `tests/integration/signup-isolation.test.ts`

**Interfaces:**
- Consumes: everything above. This is the tenancy proof (audit-tenancy's core concern).

- [ ] **Step 1: Write the test** — sign up two workspaces (A, B) end-to-end (through `provisionSignup` + verify); create a lead in A's tenant; assert that a scoped query as B's admin (`scope.ts` with B's tenantId) returns nothing from A, and A sees only A's data. This proves structural isolation for self-serve tenants.

- [ ] **Step 2: Run it** — `npx vitest run tests/integration/signup-isolation.test.ts --no-file-parallelism`. Expected: PASS.

- [ ] **Step 3: Full gate** — `pnpm typecheck`, eslint on all changed files, `pnpm test:unit -- --no-file-parallelism`, `pnpm test:integration -- --no-file-parallelism` (confirm counts, not "skipped"), `pnpm build` (confirm no Turnstile secret / no service-role key in `.next/static`). Fix anything red.

- [ ] **Step 4: Reviews** — dispatch pr-reviewer + audit-security + audit-tenancy + audit-compliance on the full diff. Fold findings TDD-first.

- [ ] **Step 5: Commit + PLAYBOOK §6 self-audit** — print the filled checklist; owner-gated commit + push.

---

## Self-Review (spec coverage)

- Signup → new tenant + admin (spec §"What a signup produces") → Tasks 5, 6. ✓
- Email verification gates login (§Flows) → Tasks 3, 4, 7. ✓
- CAPTCHA / Turnstile (§CAPTCHA, ADR-0034) → Tasks 1, 2, 6, 8. ✓
- Rate-limit + enumeration-safe + uniform timing (§Flows, AUT-05) → Task 6. ✓
- Structural tenant isolation (§security) → Task 10. ✓
- Orphan compensation (§Flows step 4) → Task 5. ✓
- SEC-07 sink for verification email (§security) → Task 4 (transport) + Task 6 (send). ✓
- UI signup + verify landing, minimal onboarding (§UI) → Tasks 8, 9. ✓
- Turnstile production fail-fast (owner decision) → Task 1. ✓
- Out-of-scope items (billing, roles, wizard, abandoned-signup sweep) → not planned, by design. ✓

**Open follow-up (WP candidate, not this plan):** the abandoned-never-verified-signup cleanup sweep (spec Open items).
