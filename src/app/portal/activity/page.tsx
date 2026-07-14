"use client";

import { useIsDesktop } from "@/lib/use-media-query";
import { ActivityDesktop } from "./activity-desktop";
import { ActivityMobile } from "./activity-mobile";

// WP-PW-4 Task 1: gate on the shared lg breakpoint (unconditional hook, before any
// return) so exactly one of the two activity views mounts — mobile (< lg) is byte-
// identical to the pre-WP-PW-4 page; desktop (>= lg) gets the admin-style table.
// Each child owns its own hooks/query entirely (no conditional hooks in one component,
// no shared state, no double-fetch).
// INTENTIONAL asymmetry: the portal shell switches chrome (rail vs. bottom nav) at md
// (768), but this page gates content at lg (1024, useIsDesktop) to match the rest of
// the desktop portal (Leads) — so 768-1024 shows desktop chrome + the mobile card list
// on purpose. Don't "fix" this to match the shell's md breakpoint.
export default function PortalActivityPage() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <ActivityDesktop /> : <ActivityMobile />;
}
