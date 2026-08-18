"use client";

import { MyTasksList } from "@/components";

// WP-TSK-5 (TSK-07): the portal "My Tasks" page — the 5th bottom tab. Same MyTasksList as
// the admin /tasks page (the approved mockup is one screen for both surfaces); this page
// supplies the portal chrome (PortalShell wraps every /portal/* route) + the portal lead
// deep-link base (?open=<ref> on /portal/leads, mirroring the admin convention).
//
// The `md:hidden` <h1> mirrors the other mobile portal pages (ActivityMobile "Your
// activity", leads-mobile "Your leads", portal-dashboard "Your dashboard"): the mobile
// top bar carries no page title, so the page supplies its own — "Your tasks" for the same
// second-person phrasing, distinct from MyTasksList's own "My Tasks" card title so the two
// headings don't repeat verbatim. At md+ the desktop rail top bar already shows "Tasks"
// (portal-nav.ts), so no page-level heading is needed there.
export default function PortalTasksPage() {
  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text md:hidden">Your tasks</h1>
      {/* WP-UX-7: the portal already labels this surface ("Your tasks" on mobile, the "Tasks"
          rail item on desktop), so MyTasksList drops its own "My Tasks" card title here — the
          two no longer repeat. The overdue badge + status filter stay in the card header. */}
      <MyTasksList leadHrefBase="/portal/leads?open=" title={null} />
    </main>
  );
}
