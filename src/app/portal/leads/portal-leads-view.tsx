"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useDesktopState } from "@/lib/use-media-query";
import { LeadsDesktop } from "./leads-desktop";
import { LeadsMobile } from "./leads-mobile";

// VP-4: the client gate — mounts exactly one of the two lists (lg breakpoint, see the note
// in leads page.tsx) and owns the shared lead dialog. `initialOpenRef` seeds ?open=<ref> so
// the partner "lead assigned" notification deep-link lands straight in the dialog (mirrors
// the admin leads view). Code-split like the admin LeadDialog (F-56).
const PortalLeadDialog = dynamic(() => import("./portal-lead-dialog").then((m) => m.PortalLeadDialog), { ssr: false });

export function PortalLeadsView({ initialOpenRef = null }: { initialOpenRef?: string | null }) {
  // C-41a: three-state, not a boolean. The server and the hydration render both say
  // "unresolved", which renders the SAME mobile markup as before (no hydration mismatch) —
  // but with its query held, so a desktop first paint no longer pays for a mobile page of
  // leads it is about to throw away. The moment the viewport resolves, exactly one list
  // fetches exactly once.
  const viewport = useDesktopState();
  const [openRef, setOpenRef] = React.useState<string | null>(initialOpenRef);

  return (
    <>
      {viewport === "desktop" ? <LeadsDesktop onOpen={setOpenRef} /> : <LeadsMobile onOpen={setOpenRef} enabled={viewport === "mobile"} />}
      {openRef && <PortalLeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </>
  );
}
