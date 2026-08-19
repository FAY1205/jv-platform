"use client";

import { NotificationPreferencesCard } from "@/components";
import { SettingsSection } from "../settings-section";

// WP-NF2b (owner decision 2026-08-20) — Settings → Notifications is MY notifications.
//
// This page used to be the workspace matrix: an admin with `settings.manage` set, per role
// bucket and per event, whether the whole tenant got email, in-app or both. That layer is gone.
// There is no workspace-level notification control any more — every user controls their own,
// scoped to their role's catalog — so the page now mounts the SAME
// `NotificationPreferencesCard` the portal /notifications page renders, against the un-gated
// `/api/me/notification-prefs`. One editor, two mounts (see the component header).
//
// REACHABLE BY EVERY ADMIN-STREAM SEAT, with no gating change needed:
//  • The Settings hub is inside the `(admin)` route group, which gates on the PRN-13 STREAM
//    (partners are redirected to their portal) and NOT on tier — member and viewer seats
//    already reach /settings/*.
//  • The hub's nav marks a capability-gated item with `requires` (settings-nav.tsx); the
//    Notifications item never carried one, so it was already listed for every seat. What used
//    to stop a member here was the ROUTE's `settings.manage` gate, and that route is retired.
// Nothing else in the hub is touched — this is one page changing what it edits, not a change
// to how the hub decides who sees what.
//
// Partners never land here (the route group redirects them); their surface is the inline card
// on /portal/notifications.

export default function NotificationSettingsPage() {
  return (
    <SettingsSection
      title="Notifications"
      description="Choose how you want to be told about things here. These settings are yours alone — everyone in the workspace sets their own. Security emails (sign-in codes, resets) are always sent."
    >
      <NotificationPreferencesCard />
    </SettingsSection>
  );
}
