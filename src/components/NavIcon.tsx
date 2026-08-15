import * as React from "react";

// NavIcon (VP-1) — the SINGLE source of navigation glyphs for both shells. AppShell and
// PortalShell each hand-drew their own paths (same stroke style, different drawings), which
// is the owner's "navigation icons are different" complaint. The drawing lives here; the
// SIZE comes from the caller's className (the portal rail renders 18px, its mobile tabs
// 22px). Decorative (aria-hidden) — the accessible name lives on the enclosing link.
// Glyphs are the admin set (the more complete one); `account` is carried over from the
// portal so its tab keeps a person icon. Tokens/`currentColor` only (PRN-12).

export type NavIconName =
  | "dashboard"
  | "leads"
  | "unmatched"
  | "runs"
  | "partners"
  | "coverage"
  | "analytics"
  | "rules"
  | "activity"
  | "tasks"
  | "settings"
  | "account"
  | "menu";

export const NAV_ICON_NAMES: readonly NavIconName[] = [
  "dashboard", "leads", "unmatched", "runs", "partners", "coverage",
  "analytics", "rules", "activity", "tasks", "settings", "account", "menu",
];

const PATHS: Record<NavIconName, React.ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>),
  leads: (<><path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" /><path d="M4 13h4l2 3h4l2-3h4" /><path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></>),
  unmatched: (<><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>),
  runs: (<><path d="M4 6h16M4 12h16M4 18h10" /></>),
  partners: (<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 11a3.2 3.2 0 0 0 0-6" /></>),
  coverage: (<><path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Z" /><path d="M9 3v15M15 6v15" /></>),
  analytics: (<><path d="M4 20V4M4 20h16" /><rect x="7" y="12" width="3" height="5" rx="1" /><rect x="12" y="8" width="3" height="9" rx="1" /><rect x="17" y="5" width="3" height="12" rx="1" /></>),
  rules: (<><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="8" cy="5" r="1.6" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="10" cy="19" r="1.6" fill="currentColor" stroke="none" /></>),
  activity: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4l3 2" /></>),
  tasks: (<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.3 2.3L15.5 9.5" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /></>),
  account: (<><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></>),
  menu: (<><path d="M4 6h16M4 12h16M4 18h16" /></>),
};

export interface NavIconProps {
  name: NavIconName;
  /** Size (and any color) utility classes — the caller owns the dimensions. */
  className?: string;
}

export function NavIcon({ name, className }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
