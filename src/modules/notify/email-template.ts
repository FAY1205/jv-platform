import { lightColors, emailFonts } from "@/lib/tokens/tokens";
import { APP_NAME } from "@/lib/app";

// ─────────────────────────────────────────────────────────────────────────────
// Survey email shell (NTF-03, SEAM-08, PRN-12). PURE HTML builders. Emails cannot
// read CSS variables and Outlook needs table layout, so every value is inlined from
// the token source (colors from lightColors, fonts from emailFonts — both in
// src/lib/tokens/tokens.ts). The LIGHT theme is the canonical brand look — dark-mode
// email theming is intentionally out of scope, and the shell declares color-scheme:
// light so mail clients don't silently re-tint the AA-vetted palette. No hardcoded
// hex or product name lives here; content builders compose this shell and pass only
// escaped fragments.
// ─────────────────────────────────────────────────────────────────────────────

export const EMAIL_COLORS = lightColors;
export const EMAIL_FONTS = emailFonts;

/** HTML-escape a value before interpolating it into an email template. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Allow only safe link schemes in an email href; anything else collapses to "#". */
function safeHref(href: string): string {
  return /^(https?:|mailto:)/i.test(href.trim()) ? href : "#";
}

/**
 * NTF-14: the per-recipient unsubscribe pair carried in a notification email's footer.
 * `typeUrl` switches off this ONE event for this recipient; `allUrl` is the global email
 * kill switch. Both are tokenized capability links (NTF-13) built by
 * modules/notify/unsubscribe. Optional everywhere: transactional/auth email has no
 * unsubscribe (NTF-05), so those builders simply never supply it.
 */
export interface UnsubscribeLinks {
  typeUrl: string;
  typeLabel: string;
  allUrl: string;
}

/** A padded <a> CTA (marigold fill, brand-contrast ink). Degrades to a plain link in Outlook. */
export function emailButton(input: { href: string; label: string }): string {
  const C = EMAIL_COLORS;
  return (
    `<a href="${escapeHtml(safeHref(input.href))}" style="display:inline-block;background:${C.brand};` +
    `color:${C.brandContrast};font-family:${EMAIL_FONTS.body};font-weight:700;font-size:15px;` +
    `text-decoration:none;padding:13px 26px;border-radius:8px;border:1px solid ${C.brandStrong}">` +
    `${escapeHtml(input.label)}</a>`
  );
}

/**
 * Wrap pre-rendered inner HTML in the branded, table-based, 600px email shell.
 * `heading`, when given, renders one visible <h1> at the top of the body (SC 1.3.1/
 * 2.4.6 — AT users navigating by heading get document structure). Digest-style
 * callers that already present their own visible heading (the count banner) omit it.
 */
export function renderEmailDocument(input: {
  title: string;
  preheader: string;
  contentHtml: string;
  heading?: string;
  /** NTF-14: per-recipient unsubscribe links, rendered in the footer. Present on every
   *  NOTIFICATION email; absent on transactional/auth email, which is not opt-out-able
   *  (NTF-05) — the caller decides, so a builder can never accidentally offer to switch off
   *  a password reset. `typeUrl`/`allUrl` are per-recipient capability links (NTF-13). */
  unsubscribe?: UnsubscribeLinks;
}): string {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const brand = escapeHtml(APP_NAME);
  const u = input.unsubscribe;
  // Same 13px/text3 scale as the footer line above it: an unsubscribe control is legally and
  // ethically required to be findable, not prominent. https-only via safeHref, escaped label.
  const unsubscribeHtml = u
    ? `<div style="margin-top:6px">` +
      `<a href="${escapeHtml(safeHref(u.typeUrl))}" style="color:${C.text3};font-size:13px">` +
      `Unsubscribe from ${escapeHtml(u.typeLabel)}</a>` +
      ` · ` +
      `<a href="${escapeHtml(safeHref(u.allUrl))}" style="color:${C.text3};font-size:13px">` +
      `Stop all notification emails</a>` +
      `</div>`
    : "";
  const heading = input.heading
    ? `<h1 style="margin:0 0 14px;font-family:${F.display};font-weight:400;font-size:21px;color:${C.text}">${escapeHtml(input.heading)}</h1>`
    : "";
  return (
    `<!DOCTYPE html>` +
    `<html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light">` +
    `<meta name="supported-color-schemes" content="light">` +
    `<title>${escapeHtml(input.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.surface2};font-family:${F.body};color:${C.text}">` +
    `<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</span>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.surface2}"><tr>` +
    `<td align="center" style="padding:28px 16px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;` +
    `background:${C.surface};border:1px solid ${C.border};border-radius:16px;overflow:hidden">` +
    // header
    `<tr><td style="padding:18px 24px;border-bottom:1px solid ${C.border}">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="width:26px;height:26px;background:${C.brand};border:1px solid ${C.brandStrong};border-radius:7px"></td>` +
    `<td style="padding-left:10px;font-family:${F.display};font-size:18px;color:${C.text}">${brand}</td>` +
    `</tr></table></td></tr>` +
    // content
    `<tr><td style="padding:6px 24px 26px">${heading}${input.contentHtml}</td></tr>` +
    // footer
    `<tr><td style="padding:18px 24px;border-top:1px solid ${C.border};background:${C.surface2};` +
    `font-family:${F.body};font-size:13px;color:${C.text3}">${brand} · Lead routing${unsubscribeHtml}</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
