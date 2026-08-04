"use client";

import { useIsDesktop } from "@/lib/use-media-query";
import { LeadsDesktop } from "./leads-desktop";
import { LeadsMobile } from "./leads-mobile";

// WP-PW-3 Task 2: gate on the shared lg breakpoint (unconditional hook, before any
// return) so exactly one of the two lead lists mounts — mobile (< lg) is byte-identical
// to the pre-WP-PW-3 page; desktop (>= lg) gets the admin-style sortable/filterable table.
// Each child owns its own hooks/query entirely (no conditional hooks in one component,
// no shared state, no double-fetch).
// INTENTIONAL asymmetry: the portal shell switches chrome (rail vs. bottom nav) at md
// (768), but this page gates content at lg (1024, useIsDesktop) because the 7-column
// desktop table needs >=1024px — so 768-1024 shows desktop chrome + the mobile card
// list on purpose. Don't "fix" this to match the shell's md breakpoint.
export default function PortalLeadsPage() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <LeadsDesktop /> : <LeadsMobile />;
}
