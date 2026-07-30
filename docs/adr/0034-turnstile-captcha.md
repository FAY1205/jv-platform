# ADR-0034: Cloudflare Turnstile for signup bot protection

- **Status:** Accepted (owner-approved, Phase D design session, 2026-07-16)
- **Date:** 2026-07-16
- **Phase / WP:** Phase D (Commercialize) · part 1 — self-serve onboarding
- **Depends on:** ADR-0033 (public self-serve signup)

## Context

ADR-0033 opens public account creation, which invites automated abuse: scripted mass
signups, disposable-email floods, and credential-stuffing reconnaissance. Email
verification and IP rate-limiting help, but neither stops a bot that drives a real
headless browser and burns through fresh mailboxes. A CAPTCHA / bot-detection challenge on
the signup form is the standard front-door defense. This is a new third-party provider and
subprocessor, so per the repo's rule it needs an ADR before code (CLAUDE.md: "no new
dependencies without an ADR"; provider choices are ADR decisions).

## Decision

**Use Cloudflare Turnstile as the signup CAPTCHA.**

- **Integration is dependency-free.** The widget loads via a `<script>` tag (no npm
  package), and the server validates the returned token with a single `fetch` to
  Turnstile's `siteverify` endpoint — the same shape as the existing `ResendTransport`.
  Two env vars, typed in `env.ts`: `TURNSTILE_SITE_KEY` (public, safe for the client) and
  `TURNSTILE_SECRET_KEY` (server-only, never sent to the client, never logged — SEC-05).
- **Fail closed.** Signup rejects the request (400) before any account work if the token
  is missing, malformed, or fails `siteverify`. A `siteverify` network error is treated as
  a failed challenge, not a bypass.
- **Non-production is not blocked.** Turnstile publishes always-pass/always-fail test keys;
  dev/preview/CI use the test keys so the flow is exercisable without a live challenge and
  the signup unit tests stub `siteverify`. Production uses the real keys.
- **Subprocessor.** Turnstile is a new subprocessor and must appear on the
  subprocessor/security page before real signups are accepted (owner deliverable, gated
  with ADR-0033's go-live).

Rejected — **Google reCAPTCHA:** heavier user friction (image challenges), and it sends
more user signal to Google; weaker privacy posture for a form that collects a new
customer's email. Rejected — **hCaptcha:** comparable to Turnstile but no advantage here,
and Turnstile's free tier + Cloudflare-native privacy stance (no ad-tech coupling) fits a
B2B signup better. Rejected — **no CAPTCHA, rely on email-verify + rate-limit alone:** the
owner explicitly chose CAPTCHA-level protection; email + IP limits do not stop a
browser-driving bot rotating IPs and mailboxes.

## Consequences

- **New subprocessor + data-residency note:** Turnstile sees signup-form interaction
  signals (not the email/password, which never leave our origin). Record it on the
  subprocessor page; it is a Cloudflare edge service, consistent with the app's existing
  Cloudflare-fronted posture.
- **Two new env vars.** `TURNSTILE_SECRET_KEY` is **required in production** via an
  `env.ts` refine (owner decision), mirroring the `RESEND_API_KEY` guard from ADR-0032's
  WP: production refuses to boot without it, so the public signup can never ship without
  bot protection. `TURNSTILE_SITE_KEY` is public and needed by the widget.
- **Client-side script:** one external `<script>` from Cloudflare on the `/signup` route
  only. It is not loaded elsewhere, keeping the third-party surface off the rest of the
  app.
- Reopens if Turnstile's terms/pricing change or abuse slips past it (e.g. add a second
  signal, or move to a paid tier) — a follow-up ADR at that point.

## Amendment (WP-SU-8, 2026-07-29): global signup ceiling

The per-identifier (5/15min) and per-IP (20/15min) signup throttles are both keyed on
attacker-chosen values — a fresh email defeats the first, a rotated IP the second — so until
this WP the only *global* bound on distributed signup abuse was Turnstile, exactly the
single-signal position the "Reopens if abuse slips past it" clause above anticipated. A
global rolling-hour ceiling of 60 now sits behind it, alerting at 30, plus a 3/24h
per-recipient cap on the victim-directed "already registered" mail.

**Accepted trade-off:** a global ceiling is by construction a small availability lever — an
attacker who burns the hour's budget also refuses honest signups. This is inherent to every
global limit, not a flaw in this one. It is accepted because the ceiling sits ~100x above
expected volume (single digits per *day*), the alert fires at half of it, `SIGNUP_ENABLED` is
off in production, and the alternative is unbounded tenant provisioning plus outbound mail.
If signup ever becomes a revenue path, revisit with a per-ASN or reputation-based bound
rather than raising this number.

**Alert semantics:** the verdict reports a *persistent condition* (`>=`), and a separate
explicit cooldown (`SIGNUP_ALERT_COOLDOWN`, 1/hour) is what makes it one email rather than one
per request. The cooldown is keyed per threshold, so a surge alert cannot consume the hour's
budget and silently swallow the ceiling alert that escalates it.

This corrects an earlier version of this amendment, which claimed both thresholds fired on
*equality* so that "each crossing produces one email". That was wrong in the worst direction.
A ceiling-refused request returns 429 before the route records an attempt, so refusals never
increment the count; the count froze at exactly the ceiling and the equality branch re-fired
on **every subsequent refused request** — an unbounded alert flood on precisely the path the
alert exists for, plus unbounded Resend volume and a sending-domain reputation risk at the
worst possible moment. Measured before the fix: 3 refused requests produced 3 alerts.
Equality also had the opposite failure — two concurrent requests stepping past the exact
threshold value lost the alert entirely. Condition-plus-cooldown is correct in both
directions and does not depend on how the count moves.

**Accepted residual (CWE-367):** the ceiling's own admit/refuse decision reads the count, then
decides, with no reservation, and the read is separated from the write by a Turnstile
round-trip and an HIBP fetch — hundreds of milliseconds in which every parallel request sees
the same pre-burst count. So **until WP-SU-9 makes the decision atomic, this ceiling bounds
_paced_ abuse only; burst over-admission is bounded by the attacker's concurrency, not by 60.**
The surge alert is what makes that visible, which is why the alert's correctness (above) is
load-bearing for this trade-off rather than a nice-to-have.

**One thing not to "fix":** do not make refused requests record under kind `signup` to unfreeze
the count. A 1-request-per-minute trickle would then hold the count at or above the ceiling
indefinitely, converting a one-hour refusal window into a permanent outage. If a refusal metric
is wanted, record it under a separate kind.

## Amendment (WP-SU-9, 2026-07-30): the ceiling TOCTOU is closed, and CAPTCHA must precede the reservation

WP-SU-9 made the throttle decision atomic by RESERVING each attempt (an `auth_attempts` row)
before the window is counted, across every credential endpoint. The signup route reserves up
front, so the global ceiling's `kindCount` now includes the request being judged — the CWE-367
residual described above ("bounds paced abuse only") is **closed**: a concurrent burst can no
longer all read the same pre-burst count. `evaluateSignupSurge` moved to a self-inclusive
`observed` count (refuse on `observed > limit`, warn on `observed >= surgeThreshold`).

That change created, and this amendment fixes, a NEW requirement found by the WP-SU-9 security
review (audit-security F-1): **CAPTCHA MUST be verified before the attempt is reserved.** Because
the ceiling counts reservations, and reservations are now written up front, a reservation written
*before* CAPTCHA would let a single IP fill the 60/hour ceiling with ~60 CAPTCHA-free requests and
refuse every honest signup for the window — a strictly cheaper anonymous DoS than the ~60
CAPTCHA-solved requests it cost under WP-SU-8. So `verifyTurnstile` now runs first, and only
CAPTCHA-passed requests reserve or count. This **reverses** the WP-SU-8 ordering rationale
("check the ceiling before the CAPTCHA so a burst costs one indexed count, not a Cloudflare
round-trip"): protecting a global availability control is worth one Turnstile round-trip per
rejected request. Turnstile tokens are single-use and Cloudflare-rate-limited, so the round-trip
cannot itself be cheaply amplified.
