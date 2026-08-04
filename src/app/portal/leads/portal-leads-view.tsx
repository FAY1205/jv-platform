"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useIsDesktop } from "@/lib/use-media-query";
import { LeadsDesktop } from "./leads-desktop";
import { LeadsMobile } from "./leads-mobile";

// VP-4: the client gate — mounts exactly one of the two lists (lg breakpoint, see the note
// in leads page.tsx) and owns the shared lead dialog. `initialOpenRef` seeds ?open=<ref> so
// the partner "lead assigned" notification deep-link lands straight in the dialog (mirrors
// the admin leads view). Code-split like the admin LeadDialog (F-56).
const PortalLeadDialog = dynamic(() => import("./portal-lead-dialog").then((m) => m.PortalLeadDialog), { ssr: false });

export function PortalLeadsView({ initialOpenRef = null }: { initialOpenRef?: string | null }) {
  const isDesktop = useIsDesktop();
  const [openRef, setOpenRef] = React.useState<string | null>(initialOpenRef);

  return (
    <>
      {isDesktop ? <LeadsDesktop onOpen={setOpenRef} /> : <LeadsMobile onOpen={setOpenRef} />}
      {openRef && <PortalLeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </>
  );
}
