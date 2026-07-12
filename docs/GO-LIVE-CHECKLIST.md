# Go-Live Checklist (Phase A)

_Owner-sequenced launch-readiness runbook. The Phase-2 product and the "Survey" redesign
are both functionally complete and merged; this is what remains to turn the finished app
into a real running service for real partners._

**Status legend:** ☐ not started · ◐ in progress · ☑ done

---

## Two verified corrections to earlier notes

Before acting, I verified every "code fix" claim against the live code. Two changed:

1. **`CRON_SECRET` is already built** — `src/lib/auth/cron-auth.ts` does a constant-time
   bearer check and `src/app/api/cron/drain-outbox/route.ts` refuses to run without it.
   So this is **not** code to write; it's a value you set in Vercel (see env vars below).

2. **The migration-0017 "zero-downtime index rebuild" is _not_ a launch blocker.**
   `0017` does a non-concurrent index rebuild, which only freezes writes _on an
   already-populated table_. Production starts **empty** (real partners are added in-app
   after launch), so applying all migrations to a fresh prod DB runs `0017` instantly with
   no lock. It only matters as a _practice for future index migrations_ once prod has real
   data — tracked as migration hygiene, not a go-live item.

---

## 🔧 YOUR setup — external accounts, money, DNS, legal (I can't do these)

Roughly in dependency order:

| # | Item | Why | Effort |
|---|------|-----|--------|
| 1 | ☐ **Production Supabase project (US region)** — create it, then apply migrations `0000`–`0018` | The app's database. US region satisfies data-residency (LGL-03: real seller PII stays in the US) | ~30 min |
| 2 | ☐ **Turn on backups (PITR) + rehearse one restore** (LGL-05) | So a mistake or outage can't lose real partner/lead data; the launch gate requires a rehearsed restore | ~20 min |
| 3 | ☐ **Vercel Pro plan** | Required for the every-5-minute digest-drain cron that Hobby won't run (the retention sweep runs daily, which Hobby's once-daily cron limit would also allow) | ~5 min + $ |
| 4 | ☐ **Set environment variables in Vercel** (exact list below) | The app reads all config from env; nothing works without these | ~15 min |
| 5 | ☐ **Email sending: Resend account + verify your domain** (SPF/DKIM/DMARC DNS records) | So digests/invites/OTP codes reach real partners instead of the dev sink | ~30 min + DNS wait |
| 6 | ☐ **Real legal text** — replace placeholder Terms/Privacy (`src/lib/legal/tos.ts`, dated 2026-07-08) with real, ideally lawyer-reviewed copy; add a plain-words security/subprocessor page (LGL-01/02/04) | Partners accept ToS at onboarding; placeholder text isn't legally sound | Varies (lawyer) |
| 7 | ☐ **Sentry account** — create a project, copy the DSN | Production error monitoring (I wire the code — see item A) | ~10 min |
| 8 | ☐ **Uptime monitor** — external watchdog pinging `/api/health` every few minutes | Highest value / lowest effort: alerts you if the whole site goes down. `/api/health` is already built for exactly this (ACT-05) | ~10 min |
| 9 | ☐ **Protect the `main` branch** on GitHub | Stops accidental force-pushes to the release branch | ~2 min |

### Exact env vars to set in Vercel (from `src/lib/env.ts`)

- `APP_ENV=production`
- `DATABASE_URL` — prod Supabase pooler connection string
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY` — email sending
- `EMAIL_FROM` — your verified sender, e.g. `TerritoryDesk <noreply@yourdomain.com>`
- `ADMIN_ALLOWLIST` — your admin email(s), comma-separated
- `CRON_SECRET` — any long random string (the crons already enforce it)
- `SENTRY_DSN` — from item 7 (only does something after code item A ships)
- `NEXT_PUBLIC_APP_NAME` — optional; product name

---

## 💻 MY code — one work-package each, your explicit go before commit/push

| # | Item | Why | Size | Status |
|---|------|-----|------|--------|
| C | **`html { font-size: 16px }` → `100%`** (`src/app/globals.css`) | Accessibility (WCAG 1.4.4): lets a user's browser text-size preference take effect. Render-neutral for default users; needs a regression pass | Small | ◐ |
| B | **Void purges seller PII immediately** (+ retention backstop) (DM-09 / LGL-02) | Voiding an import now redacts that batch's seller PII (name/phone/email/street address/raw row/notes) in the same action — instantly, per your decision. A daily backstop sweep catches any stray soft-deleted lead | Medium | ◐ |
| A | **Wire the Sentry SDK** behind the existing `logError` seam + a client error boundary (ACT-03) | `SENTRY_DSN` is plumbed but `observability.ts` only does `console.error` — nothing reaches Sentry. ⚠️ Adds `@sentry/nextjs` (a heavy new dependency) → needs an ADR, and can't be verified without your DSN. **Held for your decision** | Small–Med | ☐ (awaiting decision) |
| D | _(optional)_ Enable the commented-out **Lighthouse performance gate** in CI | Catches performance regressions on every PR | Tiny | ☐ |

---

## Sequence after Phase A

Go Live → **AI assistant** (floating chat, scoped per PRN-08) → **Roles/Team** → **Commercialize** (self-serve onboarding → Stripe billing → white-label).
