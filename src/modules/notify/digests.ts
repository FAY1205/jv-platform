import type { RunSummary } from "../analytics/run-summary";

// ─────────────────────────────────────────────────────────────────────────────
// Digest content (NTF-01/02). PURE builders: given a run's per-partner new leads
// or the run summary, produce the subject + text body. The outbox attaches the
// recipient and handles delivery/retry. SEC-05: digests carry lead reference IDs
// and coarse location only — never seller phone/email.
// ─────────────────────────────────────────────────────────────────────────────

export interface PartnerDigestLead {
  refId: string;
  city: string | null;
  state: string | null;
}

export interface PartnerDigestInput {
  appName: string;
  partnerName: string;
  portalUrl: string;
  uploadRef: string;
  leads: PartnerDigestLead[];
}

export interface DigestContent {
  subject: string;
  body: string;
}

function locationOf(lead: PartnerDigestLead): string {
  const parts = [lead.city, lead.state].filter((p) => p && p.trim() !== "");
  return parts.length ? parts.join(", ") : "location n/a";
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
  return { subject: `${n} ${noun} — ${input.appName}`, body };
}

export interface AdminSummaryInput {
  appName: string;
  uploadRef: string;
  summary: RunSummary;
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
  return { subject: `Run summary — ${input.uploadRef}`, body };
}
