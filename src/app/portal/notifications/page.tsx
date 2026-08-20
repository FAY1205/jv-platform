"use client";

import { NotificationsPage } from "@/components/NotificationsPage";

// NTF-12: the partner-stream /notifications page — the SAME component the admin page mounts
// (nothing on it is role-aware), inside the portal chrome that PortalShell wraps every
// /portal/* route with.
//
// WP-NF2b: no `preferencesHref`, deliberately — the preferences card stays INLINE here. The
// admin page links its readers to Settings → Notifications instead, and a partner cannot enter
// admin Settings, so this page is their whole self-serve surface (plus the tokenized
// unsubscribe link in every notification email).
//
// The `md:hidden` <h1> mirrors the other mobile portal pages (portal/tasks "Your tasks",
// ActivityMobile "Your activity"): the mobile top bar carries no page title, so the page
// supplies one. At md+ the desktop rail top bar shows "Notifications" (portal-nav.ts), so the
// page heading is hidden there and the document keeps exactly one <h1>.
export default function PortalNotificationsPage() {
  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text md:hidden">
        Notifications
      </h1>
      <NotificationsPage />
    </main>
  );
}
