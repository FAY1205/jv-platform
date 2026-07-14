import type { RunSummary } from "../analytics/run-summary";
import { escapeHtml, emailButton, renderEmailDocument, EMAIL_COLORS, EMAIL_FONTS } from "./email-template";

// ─────────────────────────────────────────────────────────────────────────────
// Digest content (NTF-01/02). PURE builders: given a run's per-partner new leads
// or the run summary, produce the subject + text body + branded HTML (WP-G,
// mockup 11). The outbox attaches the recipient and handles delivery/retry.
// SEC-05: digests carry lead reference IDs and coarse location only — never
// seller phone/email.
// ─────────────────────────────────────────────────────────────────────────────

export interface PartnerDigestLead {
  refId: string;
  city: string | null;
  state: string | null;
}

export interface PartnerDigestInput {
  appName: string;
  partnerName: string;
  partnerRef: string; // PR-### (PRN-14)
  portalUrl: string;
  uploadRef: string;
  leads: PartnerDigestLead[];
  partnerColor: string; // locked partner color (PRN-06); rendered as the intro swatch (PRN-14)
}

export interface DigestContent {
  subject: string;
  body: string;
  html: string;
}

function locationOf(lead: PartnerDigestLead): string {
  const parts = [lead.city, lead.state].filter((p) => p && p.trim() !== "");
  return parts.length ? parts.join(", ") : "location n/a";
}

/** WP-G: the branded HTML body of a partner digest (mockup 11). SEC-05: refId + location only. */
function partnerDigestHtml(input: PartnerDigestInput): string {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const n = input.leads.length;
  const noun = n === 1 ? "new lead" : "new leads";
  // PRN-14: the partner swatch appears ONCE, beside the partner name + PR-ref (color
  // never alone). Only a validated #RRGGBB reaches the inline CSS (defense-in-depth).
  const hex = /^#[0-9a-f]{6}$/i.test(input.partnerColor) ? input.partnerColor : null;
  const swatch = hex
    ? `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${hex};border:1px solid ${C.swatchBorder};vertical-align:middle;margin-right:6px"></span>`
    : "";
  const rows = input.leads
    .map(
      (l) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.border};font-family:${F.body}">` +
        `<span style="font-family:${F.mono};font-weight:600;color:${C.text}">${escapeHtml(l.refId)}</span>` +
        `<span style="color:${C.text3};font-size:14px"> · ${escapeHtml(locationOf(l))}</span>` +
        `</td></tr>`,
    )
    .join("");
  // The count banner IS the email's <h1> (SC 1.3.1/2.4.6) — visible heading + AT structure in one.
  const content =
    `<h1 style="margin:6px -24px 20px;text-align:center;background:${C.brandSoft};padding:26px 24px;` +
    `border-bottom:1px solid ${C.brandLine};font-weight:400">` +
    `<span style="display:block;font-family:${F.display};font-size:42px;line-height:1;color:${C.brandInk}">${n}</span>` +
    `<span style="display:block;font-family:${F.body};font-size:15px;color:${C.text2};margin-top:4px">${noun} in your territory</span></h1>` +
    `<p style="font-family:${F.body};color:${C.text2};font-size:15px">Here's what routed to ` +
    `${swatch}<strong style="color:${C.text}">${escapeHtml(input.partnerName)} (${escapeHtml(input.partnerRef)})</strong> ` +
    `today. Reach new sellers within a day for the best response.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>` +
    `<div style="margin-top:22px">${emailButton({ href: input.portalUrl, label: "Open your leads →" })}</div>`;
  return renderEmailDocument({
    title: `${n} ${noun} — ${input.appName}`,
    preheader: `${n} ${noun} routed to ${input.partnerName}`,
    contentHtml: content,
  });
}

/** NTF-01: a partner's new-lead digest for one run. */
export function buildPartnerDigest(input: PartnerDigestInput): DigestContent {
  const n = input.leads.length;
  const noun = n === 1 ? "new lead" : "new leads";
  const lines = input.leads.map((l) => `  • ${l.refId} — ${locationOf(l)}`);
  const body =
    `Hi ${input.partnerName},\n\n` +
    `You have ${n} ${noun} from the latest run (${input.uploadRef}):\n\n` +
    `${lines.join("\n")}\n\n` +
    `View them in your portal:\n${input.portalUrl}\n\n` +
    `— ${input.appName}`;
  return { subject: `${n} ${noun} — ${input.appName}`, body, html: partnerDigestHtml(input) };
}

export interface AdminSummaryInput {
  appName: string;
  uploadRef: string;
  summary: RunSummary;
  importUrl?: string; // deep link to the import (optional CTA)
}

/** WP-G: the branded HTML body of the admin run-summary email. */
function adminSummaryHtml(input: AdminSummaryInput): string {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const s = input.summary;
  const delivered = s.perPartner.reduce((t, p) => t + p.count, 0);
  const stat = (label: string, value: number) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid ${C.border};font-family:${F.body};color:${C.text2};font-size:14px">${label}</td>` +
    `<td style="padding:8px 0;border-bottom:1px solid ${C.border};font-family:${F.mono};color:${C.text};text-align:right">${value}</td></tr>`;
  const cta = input.importUrl
    ? `<div style="margin-top:22px">${emailButton({ href: input.importUrl, label: "View import →" })}</div>`
    : "";
  const content =
    `<p style="font-family:${F.body};color:${C.text2};font-size:15px">Run ` +
    `<strong style="color:${C.text}">${escapeHtml(input.uploadRef)}</strong> processed.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
    stat("Total rows", s.total) +
    stat("Distributed (kept)", s.kept) +
    stat("Assigned to partners", delivered) +
    stat("Removed (MLS-listed)", s.removed) +
    stat("Unmatched", s.unmatched) +
    stat("Previously matched", s.previouslyMatched) +
    `</table>${cta}`;
  return renderEmailDocument({
    title: `Run summary — ${input.uploadRef}`,
    preheader: `Run ${input.uploadRef} processed`,
    heading: "Run summary",
    contentHtml: content,
  });
}

/** NTF-02: the admin run-summary email. */
export function buildAdminRunSummary(input: AdminSummaryInput): DigestContent {
  const s = input.summary;
  const delivered = s.perPartner.reduce((t, p) => t + p.count, 0);
  const body =
    `Run ${input.uploadRef} processed.\n\n` +
    `  Total rows:          ${s.total}\n` +
    `  Distributed (kept):  ${s.kept}\n` +
    `  Assigned to partners: ${delivered}\n` +
    `  Removed (MLS-listed): ${s.removed}\n` +
    `  Unmatched:           ${s.unmatched}\n` +
    `  Previously matched:  ${s.previouslyMatched}\n\n` +
    `Partners with new leads: ${s.perPartner.length}\n\n` +
    `— ${input.appName}`;
  return { subject: `Run summary — ${input.uploadRef}`, body, html: adminSummaryHtml(input) };
}
