import type { QueryClient } from "@tanstack/react-query";
import type { LeadRow, LeadsPage } from "./leads-view";
import type { LeadDetail } from "./lead-dialog";

// ─────────────────────────────────────────────────────────────────────────────
// C-41b: a PARTIAL lead detail, reshaped from the list row the user just clicked.
//
// The dialog used to show six skeleton bars for a full round trip while the row that
// opened it was already sitting in the query cache carrying the identity half of the
// answer. This builds that half so the dialog can paint it immediately and skeleton only
// what the row genuinely cannot supply.
//
// Fed to TanStack's `placeholderData` — NOT `initialData`. The distinction is the whole
// safety argument: placeholder data never enters the cache and never counts as fresh, so
// the real detail is always fetched, `isPlaceholderData` stays true until it lands, and a
// stale list row can never masquerade as the record. `initialData` would do the opposite.
//
// Pure and React-free (type-only imports) so it unit-tests without a DOM.
// ─────────────────────────────────────────────────────────────────────────────

/** The list renders a missing value as an em dash; the detail renders it as "". */
const EMPTY = "—";
function undash(v: string | null | undefined): string {
  return !v || v === EMPTY ? "" : v;
}

/**
 * Reshape one admin list row into a partial `LeadDetail`.
 *
 * The shapes genuinely differ: the list row carries the seller as ONE display string
 * (`"${first} ${last}".trim()` server-side, or "—"), while the detail nests
 * `seller { first, last, phone, email }`. Splitting at the FIRST space is lossless for
 * what the dialog does with it — it re-joins the two with a single space — even when a
 * name part itself contains a space.
 *
 * Everything the row cannot know (phone, email, reason/time-to-sell, MLS reason, score
 * breakdown, routing method, activity) comes back empty; the dialog skeletons those while
 * `isPlaceholderData` is true rather than presenting them as known-empty.
 */
export function leadDetailFromRow(row: LeadRow): LeadDetail {
  const seller = undash(row.seller);
  const gap = seller.indexOf(" ");
  return {
    refId: row.refId,
    seller: {
      first: gap === -1 ? seller : seller.slice(0, gap),
      last: gap === -1 ? "" : seller.slice(gap + 1),
      phone: "",
      email: "",
    },
    address: undash(row.address),
    city: undash(row.city),
    state: undash(row.state),
    zip: undash(row.zip),
    campaign: undash(row.campaign),
    notes: "",
    reasonForSelling: "",
    motivation: "",
    timeToSell: "",
    mlsStatus: row.mlsStatus,
    mlsReason: "",
    status: row.status,
    // The row carries the headline score (the title's hot mark reads it) but never the
    // per-criterion breakdown, so the score is honestly "incomplete" until the detail lands.
    score: { total: row.scoreTotal, group: row.scoreGroup, status: "incomplete", breakdown: null },
    editable: row.mlsStatus === "kept",
    receivedAt: row.receivedAt,
    modifiedAt: row.modifiedAt,
    partner: row.partner,
    assignment: { manual: false, assignedAt: null, matchMethod: "", matchedOn: null, original: null },
    availableStatuses: [],
    activity: [],
  };
}

/**
 * Find `refId` in ANY cached page of the admin leads list and reshape it.
 *
 * Scans every `["leads", …]` entry rather than one exact key because the dialog does not
 * know which filter/sort/page the user opened the row from — and because a deep link
 * (`?open=<ref>`) may have no list cached at all, in which case this returns undefined and
 * the dialog falls back to its full skeleton. Entries under the prefix that are not list
 * pages (the nav-count entry) simply have no `leads` array and are skipped.
 */
export function adminLeadPlaceholder(qc: QueryClient, refId: string): LeadDetail | undefined {
  for (const [, page] of qc.getQueriesData<LeadsPage>({ queryKey: ["leads"] })) {
    const row = page?.leads?.find((l) => l.refId === refId);
    if (row) return leadDetailFromRow(row);
  }
  return undefined;
}
