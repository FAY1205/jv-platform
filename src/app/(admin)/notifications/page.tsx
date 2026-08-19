"use client";

import { AppShell, PageContainer, usePageHeader } from "@/components";
import { NotificationsPage } from "@/components/NotificationsPage";

// NTF-12: the admin-stream /notifications page. Auth comes from the (admin) layout; the shell
// supplies the chrome and the topbar <h1> (usePageHeader — the convention every admin page
// follows, and the reason this page carries no in-content title of its own).
//
// No sidebar nav item by design (WP-NF2 §3): the bell's "View all notifications" footer is the
// entry point, so the rail keeps its working-surface items only.
//
// `reading` width: a single-column list that is READ, not scanned — the same budget /tasks takes.
// The whole page body is the shared NotificationsPage, identical to the portal's.

function NotificationsBody() {
  usePageHeader({ title: "Notifications" });
  return (
    <PageContainer size="reading">
      <NotificationsPage />
    </PageContainer>
  );
}

export default function AdminNotificationsPage() {
  return (
    <AppShell>
      <NotificationsBody />
    </AppShell>
  );
}
