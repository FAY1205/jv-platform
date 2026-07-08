# ADR-0011: Resend as the email transport (via REST, no SDK dependency)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Phase / WP:** Phase 2 / WP-028a

## Context

NTF-03 names Resend as the delivery provider ("All email via Resend through an
outbox table"). `RESEND_API_KEY` is already in the validated env. All outbound mail
already flows through the `sendEmail` seam (`EmailTransport`) with a SEC-07 sink
guard; a `DevMailboxTransport` (WP dev-viewer) captures dev/preview mail. The only
gap is a production transport that actually calls Resend.

## Decision

Implement `ResendTransport` against the **Resend REST API** (`POST
https://api.resend.com/emails`) with `fetch` — **no `resend` npm package**. It is
constructed **only in production and only when `RESEND_API_KEY` is set**
(`resolveOutboxTransport`); non-production always resolves to `DevMailboxTransport`,
so SEC-07 holds and no real recipient can be reached from dev/preview. The `from`
identity comes from `EMAIL_FROM` (env, default is a placeholder).

- No new dependency (per "no new deps without an ADR"); the REST surface we need is
  one endpoint, and avoiding the SDK keeps the bundle and supply-chain surface small.
- Same `EmailTransport` interface as the sink/dev transports — the outbox drain is
  transport-agnostic; swapping providers later is a one-file change.

## Consequences

- The Resend **sending domain must be verified** and `EMAIL_FROM` / `RESEND_API_KEY`
  set in the **production** Supabase/host env before real digests send — a
  reality-gate item, not a dev blocker (dev uses the sink + viewer).
- We track the Resend message id in `email_outbox.provider_id`. Delivery/bounce
  webhooks (Resend → outbox status) are a later enhancement; V1 records send success
  and retries transient failures with backoff.
- If Resend is ever unsuitable, implement a new `EmailTransport` and swap it in
  `resolveOutboxTransport` — nothing else changes.
