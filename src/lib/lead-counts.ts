"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { LeadNavCounts } from "@/modules/leads/queries";

/**
 * N3C-01/Q3 — the shared client read of GET /api/leads/counts, in ONE place.
 *
 * Two surfaces need these numbers now: the nav badges (AppShell) and the leads header's
 * "N active leads · M total". They must share the query KEY, not just the endpoint —
 * a second key would be a second network request on every /leads render and, worse, two
 * caches that can disagree about the same workspace total (PRN-15: one server-side source,
 * the client never re-derives and never double-fetches).
 *
 * The key stays under the ["leads"] prefix so the existing lead-write invalidations
 * (qc.invalidateQueries({ queryKey: ["leads"] })) keep refreshing both surfaces (C-41d).
 */
export const LEAD_COUNTS_KEY = ["leads", "counts"] as const;

export function useLeadNavCounts() {
  return useQuery({
    queryKey: LEAD_COUNTS_KEY,
    queryFn: () => apiGet<LeadNavCounts>("/api/leads/counts"),
    staleTime: 30_000,
  });
}
