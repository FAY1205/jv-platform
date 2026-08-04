# Review & Verification Guide — all phases

A single place to verify what's built and see what's still pending. Work top to
bottom; each section says **what to check**, **how**, and **the pass criterion**.

---

## 0. Orientation (read once)

- **Branch model:** work accumulates on a phase branch. `main` = baseline scaffold →
  `phase-0/foundations` → `phase-1/spine` → `phase-2/distribution` (current). Each
  work package (WP) is **one commit** with a Definition-of-Done doc in
  `docs/backlog/WP-NNN.md`.
- **The contract:** `docs/SPEC.md` (every feature maps to a requirement ID). Decisions
  are in `docs/adr/`; the method is `docs/PLAYBOOK.md`.
- **Enforcement:** tests carry requirement IDs; green tests = the spec is honored.

### One-time setup
```bash
pnpm install
# .env.local must hold DATABASE_URL (EU pooler) + the Supabase keys — already set.
# Provision an admin login for yourself (pick your own strong password):
node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/provision-admin.ts you@example.com 'YourStrongPassw0rd!' dev-jv
```

### Running the app (Next 16 caveat)
Next 16 allows only **one `next dev` per folder**. If another instance holds a port,
build once and use a free port:
```bash
pnpm build && pnpm exec next start -p 4000    # then open http://localhost:4000
```

---

## 1. Fastest signal — run the automated proof first

```bash
pnpm check                                                                 # typecheck + lint + 233 unit tests
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run tests/integration   # 25 live tests vs the dev DB
```
**Pass:** everything green. The integration suite exercises tenant/partner isolation
(TST-01), auth + scope resolution (TST-12), password reset, OTP onboarding, trusted
devices, and partner-portal scoping (TST-08) against the real Supabase project.

---

## 2. Verify what's BUILT

### Phase 0 — Foundations  *(done)*
- **Check:** design system + component library, DB schema + RLS + seeds, scoping guard,
  MLS engine, Source Profile parser, env separation + email sink.
- **How:** run the app → open `/gallery` (every component in all states). Confirm
  `pnpm check` covers TST-01 (isolation), TST-02 (MLS), TST-12 (auth).
- **Pass:** `/gallery` renders; those suites are green.

### Phase 1 — The spine  *(done; §11 gate still open — see §3)*
- **Check:** upload → parse → MLS filter → assign → dedupe → recode → persist →
  colored Excel + on-screen routing ledger; void-run.
- **How (quick demo without a real file):**
  ```bash
  node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/seed-sample-coverage.ts
  node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/seed-sample-run.ts
  ```
  Then log in and open `/runs/UP-2026-001`.
- **Pass:** the routing ledger shows partner-colored distribution + `PartnerTag`
  (color + name + JV-### ref), plus Removed (MLS) and Unmatched sections. **Download**
  the `.xlsx` → opens in Excel as partner-grouped colored rows + legend + summary.
  **Void** the run (reason ≥ 3 chars) → voided badge appears.

### Phase 2 — Auth + partner portal  *(this session; 7 commits)*
Log in at `/login` with your provisioned admin, then verify each:

| WP | Verify | Pass |
| -- | ------ | ---- |
| 023 | Log in; visit `/runs`; then `/account/password` (change password with the strength meter). | Session cookie is `__Host-jv-auth` (Secure, HttpOnly); wrong password → generic error. |
| 024a | Fail login ~6× fast. | 5×"invalid", then **429 + Retry-After** (progressive lockout). |
| 024b | `/forgot` → request a reset. | Uniform "if an account exists…" message. (Reset link is emailed to the dev sink — see the note below.) |
| 025a | (Needs a partner — see §3.) Invite → `/portal/login` → email → 6-digit code → ToS. | Lands in `/portal`; partner status → active. |
| 025b | On `/portal/login`, tick "remember this device". | Next visit skips OTP; `/portal/devices` lists the device and can sign it out. |
| 026 | As a partner, open `/portal/leads`. | Only **your** leads; open one → update status → history timeline updates; **Export .xlsx** downloads your own leads. |

> **Email in dev:** all outbound email (reset links, OTP codes, invites) is intercepted
> by the SEC-07 sink — nothing reaches real inboxes. To read a dev OTP/reset value you
> currently read it from the DB or logs (real delivery via Resend is WP-028).

---

## 3. Owner-gated verifications STILL PENDING  *(the real gates)*

### Phase 1 §11 gate — process one REAL week
1. **Hand-verify the golden.** `tests/fixtures/investorfuse-week-golden.json` is a
   **provisional, pipeline-generated** baseline (26 removed / 24 kept / 47 state-fallback
   / 2 zip-override / 1 unmatched over the anonymized week). Compare its decisions to how
   you would process that week by hand. If they match → the golden is trustworthy.
2. **Run a real week end-to-end.** Log in → `/upload` → drop a **real** InvestorFuse
   `.xlsx` (from your Downloads). Confirm the routing ledger + downloaded Excel are what
   you'd actually send partners.
   - ⚠️ The real export is **national**; until real ZIP coverage is loaded (WP-031), most
     leads route to **Unmatched** by design. Load real coverage or accept unmatched for now.
- **Pass:** the on-screen + Excel output for a real week is correct → Phase 1 is done.

### Phase 2 §11 gate — real partners, real week in-app
- **Needs:** ≥ 3 real partners onboarded **in-app** (invite → OTP → ToS) and one week
  processed fully in the app.
- **Blocked on:** WP-030 (partners CRUD + the invite button in the UI), real partner
  emails, and real coverage (WP-031). Until WP-030, partners are created via the seed /
  a script rather than a screen.

---

## 4. What's PENDING to BUILD or PROVIDE

### Remaining Phase-2 work packages
| WP | Scope |
| -- | ----- |
| 027 | Two-stream notes (admin/partner, mutually invisible — PRN-13) |
| 028 | Digests + outbox (Resend) + Storage blobs/signed URLs |
| 029 | Notification center + per-event prefs |
| 030 | Partners CRUD + invite UI + deactivation→reassignment |
| 031 | **Real ZIP-coverage import** (diff → versioned/revertible) |
| 032 | Rules area (state rules / MLS patterns / recodes / Source Profiles) + drift/mapping UI + template panel |
| 033 | Listing check (LinkOnly) |
| 034 | Activity views (admin audit + partner activity) |
| 035 | Phase-2 exit gate + traceability audit |

### Carry-forward follow-ups
- **WP-018:** make `leads(tenant, dedupe_key)` a *partial* unique index
  `WHERE deleted_at IS NULL` + soft-delete voided leads (re-upload a corrected lead after a void).
- **WP-020 deferrals:** drift/mapping UI (ING-08), template panel (ING-05), Storage blobs (EXP-05).

### Owner reality-gate items *(needed for REAL partners / week / email — not for dev)*
- [ ] **ToS + Privacy** real documents (placeholder text ships today — LGL-01)
- [ ] **Resend sending-domain DNS** (SPF/DKIM/DMARC) — dev uses the email sink
- [ ] **Real ZIP-coverage spreadsheet** → imported via WP-031
- [ ] **Real partner roster** (names/emails/phones/locked colors) — entered in-app (WP-030)
- [x] **Supabase Auth config** (email OTP + keys) — done

---

## Appendix — commands & credentials

```bash
# Fast proof
pnpm check
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run tests/integration

# Read one WP's diff next to its DoD doc
git log --oneline phase-1/spine..HEAD          # the 7 Phase-2 commits
git show <hash>                                # e.g. git show ddefdbd  (WP-023)
#   docs/backlog/WP-0NN.md holds the matching Definition of Done

# Run the app on a free port
pnpm build && pnpm exec next start -p 4000

# Provision / re-provision an admin login
node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/provision-admin.ts <email> '<password>' dev-jv
```
