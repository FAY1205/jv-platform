import type { QueryClient } from "@tanstack/react-query";
import type { PartnerLeadPage, PartnerLeadRow } from "@/modules/portal/leads-contract";
import type { PortalLeadDetail } from "./portal-lead-dialog";

// ─────────────────────────────────────────────────────────────────────────────
// C-41b, portal half. Same idea as the admin lead-placeholder, DIFFERENT reshape: a portal
// list row already carries `sellerFirst` / `sellerLast` as separate fields (the admin row
// carries one joined display string), while the detail nests them under
// `seller { first, last, phone, email }`. Hence one explicit builder per dialog rather than
// a shared "generic" one that would have to guess which shape it was handed.
//
// Fed to `placeholderData`, never `initialData` — it stays out of the cache and always
// background-fetches, so a stale row cannot masquerade as the real detail.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reshape one portal list row into a partial `PortalLeadDetail`.
 *
 * Empty for everything a partner's list row cannot know: phone/email, reason for selling,
 * time to sell, source notes, activity (which since C-12 carries the status changes too),
 * and the listing check (an asynchronous server-side lookup, not a lead column). The dialog
 * skeletons those while `isPlaceholderData` is true instead of drawing them as known-empty.
 */
export function portalLeadDetailFromRow(row: PartnerLeadRow): PortalLeadDetail {
  return {
    refId: row.refId,
    seller: { first: row.sellerFirst, last: row.sellerLast, phone: "", email: "" },
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    reasonForSelling: "",
    timeToSell: "",
    notes: "",
    receivedAt: row.receivedAt,
    status: row.status,
    activity: [],
    availableStatuses: [],
    listing: { status: "pending", link: null },
  };
}

/**
 * Find `refId` in ANY cached page of the portal leads list and reshape it.
 *
 * Scans every PAGE entry (C-41a made that ONE canonical key shape — `["portal-leads", params]`
 * — shared by the mobile list, the desktop table and the dashboard preview) because the dialog
 * does not know which page or filter the row was opened from, including from the dashboard,
 * where a partner can now open a lead straight off the preview. A deep link (`?open=<ref>`)
 * with no list cached returns undefined and the dialog falls back to its full skeleton.
 *
 * A predicate, not a `queryKey` prefix: a prefix filter is element-wise, so `["portal-leads"]`
 * also matches PortalShell's nav-badge entry `["portal-leads", "count"]`, whose value is
 * `{ count }` and carries no rows at all. The optional chaining below happens to survive that
 * today, which is exactly the problem — the scan is one loosened chain away from reading
 * `.leads` off the wrong shape. The params object is what makes an entry a page.
 */
export function portalLeadPlaceholder(qc: QueryClient, refId: string): PortalLeadDetail | undefined {
  const pages = qc.getQueriesData<PartnerLeadPage>({
    predicate: (q) => q.queryKey[0] === "portal-leads" && typeof q.queryKey[1] === "object" && q.queryKey[1] !== null,
  });
  for (const [, page] of pages) {
    const row = page?.leads?.find((l) => l.refId === refId);
    if (row) return portalLeadDetailFromRow(row);
  }
  return undefined;
}
