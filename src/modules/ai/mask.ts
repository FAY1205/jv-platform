import type { AdminLeadDetail, GlobalLeadRow } from "@/modules/leads/queries";
import type { RunDetail, RunListItem } from "@/modules/run/queries";
import type { AdminActivityItem } from "@/modules/activity/queries";

// SEC-05 / PRN-10 / AIA-05: what the assistant's tools may return. THE RULE — the
// model sees exactly what the ADR-0025 PII purge would keep: city/state/zip +
// decision columns. Seller identity/contact, street address, and EVERY free-text
// field (notes, reasonForSelling, motivation, timeToSell, activity) are excluded:
// free text is both the injection channel and an unscannable PII carrier. These are
// allowlist PROJECTIONS (explicit field picks), never delete-from-copies.
// TSK-06 raised the stakes on `activity`: the timeline now carries note bodies and task
// titles (human free text), not just system labels — so it stays excluded here and in
// BANNED_KEYS, and any future tool that reaches for a lead's timeline must project it.
// TAG-04 added `tags` to the leads-list row: chip names are operator free text, so the
// allowlist projections below already drop them — `tags` joins BANNED_KEYS so the leak test
// fails loudly if a future tool hands the model a raw row instead of a masked one.

// AIS-11 (C-45b) added the audit-trail projection, whose dropped columns join the sweep:
// `before`/`after` are arbitrary jsonb row snapshots (the free-text + PII carrier of the
// audit log), `entityRef` is the RAW reference (a UUID for entity types that have no
// ref-shaped id — prompt rule 5 bans those), and `id` is the audit row's own UUID. All four
// are absent from every projection here, so the leak test holds them absent forever.
export const BANNED_KEYS = ["seller", "address", "notes", "reasonForSelling", "motivation", "timeToSell", "activity", "leads", "email", "phone", "reason", "tags", "before", "after", "entityRef", "id"] as const;

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
    path: `/leads?open=${encodeURIComponent(d.refId)}`,
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

/** The imports LIST row. `listRuns` happens to project exactly these five scalars today
 *  (run/queries.ts), so this is cheap insurance, not a fix: it puts list_imports under the
 *  same explicit-projection convention as every other tool, so a column added to listRuns
 *  later cannot reach the model unreviewed and the BANNED_KEYS leak test covers this shape.
 *  `filename` is operator-originated text and stays DATA (PRN-10) — same class maskRunDetail
 *  already keeps. */
export function maskRunListItem(r: RunListItem) {
  return {
    refId: r.refId,
    filename: r.filename,
    status: r.status,
    rowCount: r.rowCount,
    createdAt: r.createdAt,
  };
}

/** SEC-05: an actor's email reduced to "f…@domain" — enough for the model to say *whether*
 *  two entries share an actor without ever handing it a staff address (SEC-05 bans logging
 *  or emitting them). Null-safe: a system-generated entry has no actor, and anything that
 *  isn't shaped like an address (no domain part) masks to null rather than leaking verbatim. */
export function maskActorEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return `${email[0]}…@${email.slice(at + 1)}`;
}

/** Ref-shaped ids the product actually mints (leads, partners, imports, uploads, source
 *  profiles). `entityRef` is nullable and, for entity types without a public reference,
 *  holds an internal UUID — which prompt rule 5 forbids the model from writing. Anything
 *  that isn't ref-shaped is therefore projected as null, not passed through. */
const REF_SHAPED = /^(LD|PR|IM|UP|SP)-/i;

/** AIS-11 (C-45b): the audit-trail projection for `get_recent_activity`. Allowlist, like
 *  every mask here — `before`/`after` (arbitrary jsonb row snapshots: note bodies, filenames,
 *  emails, anything a future audited column carries) and the row `id` are DROPPED ENTIRELY,
 *  never delete-from-a-copy. `action`/`entityType` are system-minted enum-ish tokens
 *  (categorize.ts keys off them), not operator free text. */
export function maskActivityItem(a: AdminActivityItem) {
  return {
    when: a.when,
    actor: maskActorEmail(a.actor),
    action: a.action,
    entityType: a.entityType,
    ref: a.entityRef && REF_SHAPED.test(a.entityRef) ? a.entityRef : null,
    category: a.category,
  };
}

export function maskRunDetail(d: RunDetail) {
  return {
    upload: { refId: d.upload.refId, filename: d.upload.filename, status: d.upload.status, rowCount: d.upload.rowCount, createdAt: d.upload.createdAt, voidReason: d.upload.voidReason },
    // Project summary to safe scalars only — DROP perPartner ({partnerId,count}[])
    // which carries a raw internal partner UUID; `distribution` below already
    // carries the named per-partner breakdown ({name,refId}).
    summary: { total: d.summary.total, kept: d.summary.kept, removed: d.summary.removed, unmatched: d.summary.unmatched },
    distribution: d.distribution.map((x) => ({ name: x.name, refId: x.refId, count: x.count })),
    path: `/imports/${d.upload.refId}`,
  };
}
