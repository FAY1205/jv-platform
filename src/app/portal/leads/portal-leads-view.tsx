"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useDesktopState } from "@/lib/use-media-query";
import { LeadsDesktop } from "./leads-desktop";
import { LeadsMobile } from "./leads-mobile";

// VP-4: the client gate — mounts exactly one of the two lists (lg breakpoint, see the note
// in leads page.tsx) and owns the shared lead record. `initialOpenRef` seeds ?open=<ref> so
// the partner "lead assigned" notification deep-link lands straight in the record (mirrors
// the admin leads view). Code-split like the admin LeadDialog (F-56).
const PortalLeadDialog = dynamic(() => import("./portal-lead-dialog").then((m) => m.PortalLeadDialog), { ssr: false });

/**
 * The shape a lead reference may have before it is allowed to become a REQUEST PATH SEGMENT.
 *
 * `?open=` is attacker-controllable (it arrives in a link) and the ref it carries is
 * interpolated straight into `/api/portal/leads/<ref>` by the dialog below. Today the
 * mis-targeted route is gated server-side, so this is defence in depth rather than the
 * control — but the seeding boundary is the right place to say what a ref IS, because a
 * server gate somewhere else is one refactor away from not being the thing that saved us.
 * Deliberately loose (alphanumerics and hyphens, bounded): it has to accept `JV-…` and every
 * future ref scheme, and its job is to exclude `../`, `?`, `#` and friends — not to be a
 * second copy of the ref-ID grammar that would drift from the real one.
 */
const OPEN_REF_SHAPE = /^[A-Za-z0-9-]{1,32}$/;

export function PortalLeadsView({ initialOpenRef = null }: { initialOpenRef?: string | null }) {
  // C-41a: three-state, not a boolean. The server and the hydration render both say
  // "unresolved", which renders the SAME mobile markup as before (no hydration mismatch) —
  // but with its query held, so a desktop first paint no longer pays for a mobile page of
  // leads it is about to throw away. The moment the viewport resolves, exactly one list
  // fetches exactly once.
  const viewport = useDesktopState();
  const [openRef, setOpenRef] = React.useState<string | null>(
    initialOpenRef && OPEN_REF_SHAPE.test(initialOpenRef) ? initialOpenRef : null,
  );

  return (
    <>
      {/* N5-20: the record is a non-modal side panel from 768px up, so the list beside it stays
          visible and clickable — `openRef` goes DOWN as well as up, so the row on screen can
          say which lead the panel is showing. */}
      {viewport === "desktop" ? <LeadsDesktop onOpen={setOpenRef} openRef={openRef} /> : <LeadsMobile onOpen={setOpenRef} openRef={openRef} enabled={viewport === "mobile"} />}
      {/* N5-20: the panel stays mounted across a record switch — tapping another row changes
          `openRef` and the panel re-keys its queries in place instead of closing and reopening.
          The `?open=` seeding above is untouched: it is a first-mount seed, and closing clears
          the state only (this route has never rewritten the URL on close). */}
      {openRef && <PortalLeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </>
  );
}
