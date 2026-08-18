"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { portalLeadsKey, portalLeadsUrl, type PortalLeadsParams, type PartnerLeadPage } from "@/modules/portal/leads-contract";

// C-41a: the ONE hook every portal-leads reader uses (mobile card list, desktop table,
// dashboard recent-leads preview). Key and url both come from the same normalized params
// (see leads-contract), so equivalent reads share a cache entry instead of each inventing
// their own — the shared-hook half of "align keys / collapse onto one shared hook".
// Follows the tags-client.ts precedent: server data lives in the query cache only (§6.17).

/**
 * The caller's own leads, server-side paginated/sorted/filtered.
 *
 * `enabled: false` holds the fetch WITHOUT unmounting the view — used by the two callers
 * that must not fetch for a viewport they aren't actually in: the mobile list before the
 * media query has resolved, and the desktop-only dashboard preview on a phone.
 */
export function usePortalLeads(params: PortalLeadsParams, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: portalLeadsKey(params),
    queryFn: () => apiGet<PartnerLeadPage>(portalLeadsUrl(params)),
    enabled,
    // Perf: keep the prior page visible while the next page/sort/filter loads rather than
    // flashing back to skeletons (the pre-C-41 behavior of both lists and the dashboard).
    placeholderData: keepPreviousData,
  });
}
