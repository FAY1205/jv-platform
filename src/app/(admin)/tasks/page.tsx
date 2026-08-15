"use client";

import { AppShell, MyTasksList, usePageHeader } from "@/components";

// WP-TSK-5 (TSK-07): the admin "My Tasks" page — a standalone view of the actor's own
// open tasks, grouped Overdue / Today / Upcoming (+ a Done toggle), each row deep-linking
// to its lead. The list itself is MyTasksList (shared verbatim with the portal's
// /portal/tasks — the approved mockup is one screen for both surfaces); this page only
// supplies the admin shell + the admin lead deep-link base (?open=<ref> on /leads,
// same convention the retired /leads/[ref] redirect and notifications already use).

function TasksBody() {
  usePageHeader({ title: "Tasks" });
  return <MyTasksList leadHrefBase="/leads?open=" />;
}

export default function TasksPage() {
  return (
    <AppShell>
      <TasksBody />
    </AppShell>
  );
}
