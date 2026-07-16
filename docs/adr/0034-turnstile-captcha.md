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
