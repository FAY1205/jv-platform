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
    `</table>${cta}`;
  return renderEmailDocument({
    title: `Run summary — ${input.uploadRef}`,
    preheader: `Run ${input.uploadRef} processed`,
    heading: "Run summary",
    contentHtml: content,
  });
}

// ── Hot-lead alerts (SCR / NTF) ───────────────────────────────────────────────
// SEC-05: like every digest, a hot alert carries the reference ID, coarse location,
// and the score — never seller phone/email/identity.

export interface HotAlertLead {
  refId: string;
  city: string | null;
  state: string | null;
  score: number;
}

/** Shared HTML rows for a hot-lead list (refId · location · score/50). */
function hotRowsHtml(leads: HotAlertLead[]): string {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  return leads
    .map(
      (l) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.border};font-family:${F.body}">` +
        `<span style="font-family:${F.mono};font-weight:600;color:${C.text}">${escapeHtml(l.refId)}</span>` +
        `<span style="color:${C.text3};font-size:14px"> · ${escapeHtml(locationOf(l))}</span>` +
        `<span style="float:right;font-family:${F.mono};font-weight:600;color:${C.text}">${l.score}/50</span>` +
        `</td></tr>`,
    )
    .join("");
}

export interface PartnerHotAlertInput {
  appName: string;
  partnerName: string;
  partnerRef: string;
  partnerColor: string;
  portalUrl: string;
  leads: HotAlertLead[];
}

/** A partner's hot-lead alert for a run (only their own assigned hot leads). */
export function buildPartnerHotAlert(input: PartnerHotAlertInput): DigestContent {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const n = input.leads.length;
  const noun = n === 1 ? "hot lead" : "hot leads";
  const hex = /^#[0-9a-f]{6}$/i.test(input.partnerColor) ? input.partnerColor : null;
  const swatch = hex
    ? `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${hex};border:1px solid ${C.swatchBorder};vertical-align:middle;margin-right:6px"></span>`
    : "";
  const content =
    `<p style="font-family:${F.body};color:${C.text2};font-size:15px">` +
    `${swatch}<strong style="color:${C.text}">${escapeHtml(input.partnerName)} (${escapeHtml(input.partnerRef)})</strong> — ` +
    `you have ${n} high-priority ${noun} in this run. Call them first.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${hotRowsHtml(input.leads)}</table>` +
    `<div style="margin-top:22px">${emailButton({ href: input.portalUrl, label: "Open your leads →" })}</div>`;
  const lines = input.leads.map((l) => `  • ${l.refId} — ${locationOf(l)} — ${l.score}/50`);
  const body =
    `Hi ${input.partnerName},\n\n` +
    `You have ${n} high-priority ${noun} in the latest run:\n\n${lines.join("\n")}\n\n` +
    `Open your portal:\n${input.portalUrl}\n\n— ${input.appName}`;
  return {
    subject: `${n} hot ${n === 1 ? "lead" : "leads"} in your territory — ${input.appName}`,
    body,
    html: renderEmailDocument({ title: `${n} ${noun} — ${input.appName}`, preheader: `${n} high-priority ${noun}`, heading: "Hot leads", contentHtml: content }),
  };
}

export interface AdminHotAlertInput {
  appName: string;
  uploadRef: string;
  leads: HotAlertLead[];
  /** Deep link to the hot-filtered leads list. */
  hotUrl?: string;
}

/** The admin's hot-lead alert for a run (every hot kept lead, incl. house + unmatched). */
export function buildAdminHotAlert(input: AdminHotAlertInput): DigestContent {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const n = input.leads.length;
  const noun = n === 1 ? "hot lead" : "hot leads";
  const cta = input.hotUrl ? `<div style="margin-top:22px">${emailButton({ href: input.hotUrl, label: "View hot leads →" })}</div>` : "";
  const content =
    `<p style="font-family:${F.body};color:${C.text2};font-size:15px">Run ` +
    `<strong style="color:${C.text}">${escapeHtml(input.uploadRef)}</strong> produced ${n} high-priority ${noun}.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${hotRowsHtml(input.leads)}</table>${cta}`;
  const lines = input.leads.map((l) => `  • ${l.refId} — ${locationOf(l)} — ${l.score}/50`);
  const body =
    `Run ${input.uploadRef} produced ${n} high-priority ${noun}:\n\n${lines.join("\n")}\n\n— ${input.appName}`;
  return {
    subject: `${n} hot ${n === 1 ? "lead" : "leads"} — ${input.appName}`,
    body,
    html: renderEmailDocument({ title: `${n} ${noun} — ${input.appName}`, preheader: `${n} high-priority ${noun} in ${input.uploadRef}`, heading: "Hot leads", contentHtml: content }),
  };
}

// ── Task due reminder (TSK-08) ────────────────────────────────────────────────
// SEC-05, and narrower than every other builder here: a due-task nudge carries the
// lead reference, coarse location, and the task's own title — nothing else off the
// lead. Seller name/phone/email never enter this template, and there is no field
// through which they could: the input type simply has no seat for them.

export interface TaskDueReminderInput {
  appName: string;
  /** The task's own title — free text a teammate typed (escaped, never executed: PRN-10). */
  taskTitle: string;
  /** "YYYY-MM-DD" (TSK-10 calendar date). */
  dueOn: string;
  /** Past its due date rather than due today — decided by the caller's injected clock. */
  overdue: boolean;
  leadRef: string;
  city: string | null;
  state: string | null;
  /** Deep link to the lead, per role (admin `/leads?open=…`, partner `/portal/leads/…`). */
  leadUrl: string;
}

/** TSK-08: the one-shot due/overdue nudge for a task's recipient. */
export function buildTaskDueReminder(input: TaskDueReminderInput): DigestContent {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const when = input.overdue ? "overdue" : "due today";
  const location = locationOf({ refId: input.leadRef, city: input.city, state: input.state });
  const heading = input.overdue ? "Task overdue" : "Task due today";
  const content =
    `<p style="font-family:${F.body};color:${C.text2};font-size:15px">Your task is ${when} ` +
    `(<span style="font-family:${F.mono}">${escapeHtml(input.dueOn)}</span>).</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
    `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.border};font-family:${F.body};color:${C.text};font-size:15px">` +
    `${escapeHtml(input.taskTitle)}</td></tr>` +
    `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.border};font-family:${F.body}">` +
    `<span style="font-family:${F.mono};font-weight:600;color:${C.text}">${escapeHtml(input.leadRef)}</span>` +
    `<span style="color:${C.text3};font-size:14px"> · ${escapeHtml(location)}</span></td></tr>` +
    `</table>` +
    `<div style="margin-top:22px">${emailButton({ href: input.leadUrl, label: "Open the lead →" })}</div>`;
  const body =
    `Your task is ${when} (${input.dueOn}):\n\n` +
    `  • ${input.taskTitle}\n` +
    `  • ${input.leadRef} — ${location}\n\n` +
    `Open the lead:\n${input.leadUrl}\n\n— ${input.appName}`;
  return {
    subject: `Task ${when}: ${input.leadRef} — ${input.appName}`,
    body,
    html: renderEmailDocument({
      title: `Task ${when} — ${input.leadRef}`,
      preheader: `Task ${when} on ${input.leadRef}`,
      heading,
      contentHtml: content,
    }),
  };
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
    `  Unmatched:           ${s.unmatched}\n\n` +
    `Partners with new leads: ${s.perPartner.length}\n\n` +
    `— ${input.appName}`;
  return { subject: `Run summary — ${input.uploadRef}`, body, html: adminSummaryHtml(input) };
}
