# WP-G — Email + Export brand surfaces (Survey identity)

**Status:** design · **Branch:** phase-2/distribution · **Date:** 2026-07-12
**Inputs:** IMPLEMENTATION-PLAN.md §WP-G · mockups `11-email.html`, `12-export-legend.html` ·
current code: `src/modules/notify/*`, `src/lib/auth/notify.ts`, `src/modules/export/render.ts`
**Owner calls (2026-07-12):** (1) digests get **full mockup-11 fidelity** via a new nullable
`email_outbox.html` column; (2) **all partner-facing emails** adopt a shared Survey HTML shell.

---

## 1. Context & problem

Every email the app sends today is **plain-text**. Two transports:

- **Transactional / auth** (`invite`, `otp`, `password_reset`, `password_changed`, `lockout`,
  `auth_anomaly`, `trust_reuse`) — built in `src/lib/auth/notify.ts`, sent **directly** via
  `sendEmail(EmailMessage, transport)`. `EmailMessage` already carries an optional `html`, and
  the transports (`ResendTransport`, `DevMailboxTransport`) already forward it. → **zero-schema**.
- **Digest / summary** (`partner_digest`, `admin_run_summary`, `status_change`) — built in
  `src/modules/notify/digests.ts` / `outbox.ts`, enqueued into the `email_outbox` table (which has
  **only a `body` text column**), then drained through `sendEmail({ text: row.body })`. Rendering
  mockup-11's per-lead HTML needs the structured lead list, which exists only at **enqueue** time →
  storing rendered HTML needs a **new column**.

Mockup 11 is the partner daily digest; mockup 12 is the export. WP-G makes both look like Survey.

The export renderer already fills rows/legend from the Survey partner tints (WP-A). "Verify
`contrastText` is AA on the saturated tints" surfaced a real defect (see §4).

## 2. Non-negotiables that bind this work

- **SEC-07** — non-prod can never email a real partner. All mail already routes through the
  `guardOutbound` sink + `DevMailboxTransport`. This WP touches only message *content*, never the
  transport selection — the guard stays intact and is re-asserted by test.
- **SEC-05** — digests carry lead **refId + coarse location (city/state) only**, never seller
  phone/email. (The mockup's street addresses are demo fiction; the real digest keeps refId +
  city/state, exactly as the current text digest does.)
- **SEC-06** — export cell sanitization (`=,+,-,@,\t,\r` prefixes) is **untouched**.
- **PRN-12 / SEAM-08** — no hardcoded hex or product name in template code. Email/export inline
  values are imported from `lightColors` in `src/lib/tokens/tokens.ts`; the product name is
  `APP_NAME` from `@/lib/app`. (The token file's own header already names emails + the export
  legend as its off-CSS consumers.)
- **PRN-14** — partner color is never the sole signal: name + `JV-###` accompany color in the
  digest intro, in every export row (JV Partner Name column), and in the legend.
- **PRN-01** — the email builders and `contrastText` stay **pure** (input → HTML/ARGB string; no
  DB/fetch/Date.now).
- **DM-08 / goldens** — see §4: the export change alters font-color bytes, but there is **no
  export-bytes golden** (determinism is verified semantically), so nothing re-pins.

## 3. Part 1 — Email (mockup 11 + shared shell)

### 3.1 Architecture — one shell, many templates

A new pure module owns the email chrome; each template composes it.

```
src/modules/notify/email-template.ts   (NEW, pure)
  escapeHtml(s)                         → HTML-escape every interpolated value
  renderEmailDocument({title, preheader, contentHtml}) → full table-based <html> doc
  emailButton({href, label})            → bulletproof-ish padded <a> CTA
  emailPanel(innerHtml) / emailDivider()/ emailMuted(text)  → shared fragments
  EMAIL_COLORS, EMAIL_FONTS             → light-theme values pulled from lightColors
```

- **One clear purpose:** turn Survey token *values* + content fragments into email-safe HTML.
  Consumers pass content; they never see raw hex or table scaffolding.
- **Boundaries:** template-specific content (lead rows, stat table, OTP code block) lives in the
  digest/auth builders; only reusable chrome lives in `email-template.ts`.

### 3.2 Email-HTML fidelity decisions (the inline-style constraint)

- **Table-based layout, fully inline styles.** Clients strip `<head>`/`<style>` and don't support
  CSS custom properties; Outlook needs tables. Outer 100%-width table (paper bg) → centered
  600px card table (surface bg, `line` border). No flexbox/grid.
- **Light theme only.** Dark-mode email theming (per-client `prefers-color-scheme`) is a known
  hard problem that fights inline styles; the canonical Survey brand look is the light palette.
  Documented decision — not an omission. (The mockup's ◐ toggle is a mockup affordance.)
- **Font fallback stacks** (web fonts don't load in mail clients): display →
  `Georgia,'Times New Roman',serif` (Fraunces intent); body →
  `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`; data/mono →
  `'SF Mono',ui-monospace,'Roboto Mono',Menlo,Consolas,monospace`. Mirrors the mockup's stacks.
- **CTA button** = padded `<a>` (bg `brand`, text `brandContrast` #20160A, border `brandStrong`).
  Outlook renders it as a flat link (acceptable degradation; VML bulletproofing is out of scope).
- **Preheader** = visually-hidden preview-text span (first line in the body).
- **Escaping:** every interpolated value (partner name, city/state, subject-ish text) passes
  through `escapeHtml`. Links are app-generated (portal/invite/reset) but still escaped in `href`.

### 3.3 Templates

**Partner digest (mockup 11), SEC-05-clean.** `buildPartnerDigest` returns `{subject, body, html}`.
- Header: route-glyph logo + `APP_NAME` wordmark.
- Banner: big serif count + "new leads in your territory".
- Intro: "Here's what routed to **{partnerName} ({partnerRef})** today." (PRN-14: name + JV-ref).
- Lead rows: optional partner-color swatch + refId (mono) + location (city, state). **Lists all
  leads** (matches the text body — no silent truncation; drop the mockup's "…N more" line, which
  only applies when truncating).
- CTA: "Open your leads →" → `portalUrl`. Footer: partner notice + manage-notifications / sign-in.
- **Input gains** `partnerRef` (from `g.ref`, already selected in `enqueueRunDigests`) and optional
  `partnerColor` (add `partners.color` to the existing partner select — one column). Swatch is
  omitted if no color is supplied (graceful).

**Admin run summary (no mockup — compose the shell).** `buildAdminRunSummary` returns
`{subject, body, html}`: shell + a stat table (Total / Distributed / Assigned / Removed /
Unmatched / Previously matched, mono numerics) + CTA to the import. Content mirrors the text body.

**Auth emails (shell + terse content).** Each `build*Email` in `lib/auth/notify.ts` gains `html`:
- `invite` → shell + copy + CTA button (invite link).
- `otp` → shell + a large mono, letter-spaced code block + "expires in 10 minutes". **Text body
  keeps the code** so the dev-mailbox `CODE_RE` extraction is unchanged.
- `password_reset` → shell + CTA "Reset your password" (link) + "within 30 minutes". Text keeps
  the raw link (dev-mailbox `LINK_RE`).
- `password_changed` / `lockout` / `auth_anomaly` / `trust_reuse` → shell + heading + paragraph
  (terse security notices; no CTA where there's no link).
- `status_change` (admin alert, built inline in `outbox.ts`) → wrap its body via the shell.

### 3.4 Wiring (minimal)

- **Schema:** `email_outbox` gains `html: text("html")` (**nullable**). Migration `0016_*`:
  `ALTER TABLE "email_outbox" ADD COLUMN "html" text;` generated via the repo's drizzle-kit script
  (+ meta snapshot + journal). **RLS** unchanged — the table is already deny-by-default / service-
  role, and a nullable additive column needs no policy change. **Index** N/A (html is never a
  predicate). **Seed** N/A (existing rows are NULL; drain falls back to text). All four documented
  in the migration comment per the schema-change rule. Applied to the local dev DB so integration
  tests run.
- **`EnqueueEmailInput`** gains `html?: string`; `enqueueEmail` inserts it.
- **`enqueueRunDigests`** passes `c.html` / `summary.html`; the partner select adds `color`.
- **`drainOutbox`** sends `html: row.html ?? undefined` alongside `text: row.body` → multipart
  when present; text-only for old/pending rows and any null-html kind (fully backward-compatible).
- **Auth path** needs no plumbing — `sendEmail` → transport already forwards `EmailMessage.html`.
- **Dev mailbox** unchanged: `bodyOf` still prefers `text`, so the `/dev/emails` viewer keeps
  showing text and its OTP/link extraction is untouched (and we avoid rendering our HTML in the
  admin viewer — no new XSS surface). Branded HTML is proven via the walkthrough gallery route.

## 4. Part 2 — Export (mockup 12)

### 4.1 Defect found by the "verify contrastText is AA" step

`contrastText()` picks text color by a **YIQ brightness threshold (`> 0.6`)**, not WCAG. Measured
over all 20 `PARTNER_SWATCHES`, it picks the **wrong** color for **8** tints, and in each the
picked color **fails AA** while the other choice passes — e.g. clay `#B4623F` → white 4.41:1
(black = 4.76), sage `#6E8B5E` → white 3.81 (black 5.52), seafoam `#5E9E8E` → white 3.11
(black 6.76). Every swatch has a passing choice, so the fix is deterministic.

### 4.2 Fix

- Rewrite `contrastText(hex)` to compute the **WCAG relative-luminance contrast ratio** of the fill
  vs `#000000` and vs `#FFFFFF` and return the higher-contrast ARGB. Pure; cites SC 1.4.3;
  supersedes the YIQ heuristic. Still returns only `FF000000` / `FFFFFF` (existing `export.test.ts`
  regex stays green).
- Apply that font color to the **legend color cell** (`JV_Color_Legend` col 3), which currently
  writes the hex string as default-black text on the fill → fails badly on dark tints
  (e.g. wine `#7A3B45` black = 2.54:1). One line; deterministic; part of "the legend reads".

### 4.3 Determinism / goldens

No export-*bytes* golden exists (determinism is the semantic reload+compare contract in
`render.ts`; the only golden, `investorfuse-week-golden.json`, pins the **pipeline**, which WP-G
does not touch). The fix keeps output deterministic and doesn't alter any rules-snapshot input, so
**nothing re-pins** (DM-08 satisfied). SEC-06 sanitization is untouched.

## 5. Testing (TDD-first; requirement-ID names)

- `tests/unit/email-template.test.ts` — `escapeHtml` neutralizes `<>&"'`; `renderEmailDocument`
  produces a single `<html>` doc, inlines `lightColors` values (no CSS vars, no raw literal hex in
  the *builder* source — values come from tokens), includes a preheader, uses `APP_NAME` not a
  hardcoded product name.
- `tests/unit/digests.test.ts` (extend/create) — `buildPartnerDigest`/`buildAdminRunSummary`:
  (a) NTF-01 subject/body preserved; (b) **SEC-05** — html contains refId + city/state and **no**
  seller phone/email even if such fields were present; (c) PRN-14 — html contains
  `{partnerName} ({partnerRef})`; (d) html is escaped (a partner named `<b>` doesn't inject markup).
- `tests/unit/auth-email.test.ts` (extend/create) — invite/otp/reset now set `html`; **text still
  carries the code / raw link** (dev-mailbox contract); `guardOutbound` still sinks in non-prod
  (SEC-07) when sent through `sendEmail`.
- `tests/unit/export-contrast.test.ts` — for **every** `PARTNER_SWATCHES` hex, `contrastText` result
  achieves WCAG ≥ 4.5:1; the rendered color-ON rows and legend color cells set an AA font color on
  every tint. Requirement: `EXP-06/PRN-14: export text meets WCAG AA on every partner tint`.
- Full unit suite green **serial** (`pnpm test:unit -- --no-file-parallelism`); `pnpm typecheck`
  separately; integration export tests (serial, local DB) still green; lint the changed files.

## 6. Owner walkthrough (before commit)

Throwaway **public** preview route `src/app/gallery/emails/` (public per `src/proxy.ts`) that
renders the **real** builders' HTML (digest, admin summary, invite, otp, reset) with mock data,
inside sandboxed `<iframe srcdoc>` frames. Screenshot via Playwright against `preview_start`
name `web`. For export: a small server-rendered HTML proof of the legend + a color-ON row using the
**real** `contrastText` output + real partner colors, demonstrating AA on the previously-failing
tints (xlsx can't render in-browser). **Delete the route before committing.** Emails are light-only
(documented); the export proof has no theme.

## 7. Self-review & audits (on the diff, before commit)

PLAYBOOK §6 checklist printed. Then `pr-reviewer` + `audit-design-system` + `audit-a11y`
(email contrast/semantics, export AA) + `audit-security` (SEC-05/06/07 unchanged, no XSS in the
email HTML / preview route). Findings triaged before the walkthrough → one commit.

## 8. Out of scope / WP candidates

- Rendering branded HTML inside the `/dev/emails` viewer (XSS-safe iframe) — nice for dev testing;
  deferred.
- Dark-mode email variants.
- VML bulletproof buttons for legacy Outlook.
- Per-tenant white-label email logo/name (SET-09) — the shell reads `APP_NAME` today; the swap
  point exists.
