"use client";

import { usePageHeader } from "@/components";

// WS-7: the Settings hub shows its title in the topbar (like every other list/hub page).
// The layout is a server component, so this tiny client child owns the usePageHeader call
// and renders nothing; unmounting on navigation clears the topbar title.
export function SettingsHeader() {
  usePageHeader({ title: "Settings" });
  return null;
}
