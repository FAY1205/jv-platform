"use client";

import * as React from "react";
import { usePreferences, setPreferences, nextTheme, type ThemePref } from "@/lib/preferences";
import { IconButton } from "./IconButton";

// ThemeToggle (WP-B) — the topbar theme control, cycling system → light → dark. Reads and
// writes the one prefs store; useApplyTheme (in AppShell) keeps <html data-theme> in sync.

const ICON: Record<ThemePref, React.ReactNode> = {
  system: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></>,
  dark: <path d="M20 14.5A8 8 0 1 1 9.5 4 7 7 0 0 0 20 14.5z" />,
};
const NEXT_LABEL: Record<ThemePref, string> = { system: "light", light: "dark", dark: "system" };

export function ThemeToggle() {
  const { theme } = usePreferences();
  return (
    <IconButton
      aria-label={`Theme: ${theme}. Switch to ${NEXT_LABEL[theme]}`}
      onClick={() => setPreferences({ theme: nextTheme(theme) })}
    >
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICON[theme]}
      </svg>
    </IconButton>
  );
}
