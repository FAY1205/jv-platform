import type { AdminLeadDetail, GlobalLeadRow } from "@/modules/leads/queries";
import type { RunDetail } from "@/modules/run/queries";

// SEC-05 / PRN-10 / AIA-05: what the assistant's tools may return. THE RULE — the
// model sees exactly what the ADR-0025 PII purge would keep: city/state/zip +
// decision columns. Seller identity/contact, street address, and EVERY free-text
// field (notes, reasonForSelling, motivation, timeToSell, activity) are excluded:
// free text is both the injection channel and an unscannable PII carrier. These are
// allowlist PROJECTIONS (explicit field picks), never delete-from-copies.

export const BANNED_KEYS = ["seller", "address", "notes", "reasonForSelling", "motivation", "timeToSell", "activity", "leads", "email", "phone", "reason"] as const;

export interface MaskedPartnerRef { name: string; refId: string }
const partnerRef = (p: { name: string; refId: string } | null): MaskedPartnerRef | null =>
  p ? { name: p.name, refId: p.refId } : null;

export function maskLeadDetail(d: AdminLeadDetail) {
  return {
    refId: d.refId,
    city: d.city, state: d.state, zip: d.zip,
    campaign: d.campaign,
    mlsStatus: d.mlsStatus, mlsReason: d.mlsReason,
    status: d.status,
    receivedAt: d.receivedAt,
    partner: partnerRef(d.partner),
    manualAssignment: d.assignment.manual,
    matchMethod: d.assignment.matchMethod,
    contactAndNotes: "Not available to the assistant - open the lead page.",
    path: `/leads/${d.refId}`,
  };
}

export function maskLeadRow(r: GlobalLeadRow) {
  return {
    refId: r.refId,
    city: r.city, state: r.state, zip: r.zip,
    campaign: r.campaign,
    status: r.status,
    partner: partnerRef(r.partner),
    receivedAt: r.receivedAt,
  };
}

export function maskRunDetail(d: RunDetail) {
  return {
    upload: { refId: d.upload.refId, filename: d.upload.filename, status: d.upload.status, rowCount: d.upload.rowCount, createdAt: d.upload.createdAt, voidReason: d.upload.voidReason },
    // Project summary to safe scalars only — DROP perPartner ({partnerId,count}[])
    // which carries a raw internal partner UUID; `distribution` below already
    // carries the named per-partner breakdown ({name,refId}).
    summary: { total: d.summary.total, kept: d.summary.kept, removed: d.summary.removed, unmatched: d.summary.unmatched, previouslyMatched: d.summary.previouslyMatched },
    distribution: d.distribution.map((x) => ({ name: x.name, refId: x.refId, count: x.count })),
    path: `/imports/${d.upload.refId}`,
  };
}
