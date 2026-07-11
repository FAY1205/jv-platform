"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// WS-7: the Settings hub left-nav. Grouped sections (Account / Workspace / Plan) under
// /settings; the active item is derived from the URL. Sections fill in across the WS-7
// slices; Billing + Team are intentional stubs (member role + billing come later).

interface NavItem { href: string; label: string }
const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Account", items: [
    { href: "/settings/profile", label: "Profile" },
    { href: "/settings/security", label: "Security" },
    { href: "/settings/appearance", label: "Appearance" },
  ] },
  { label: "Workspace", items: [
    { href: "/settings/workspace", label: "General" },
    { href: "/settings/notifications", label: "Notifications" },
    { href: "/settings/data", label: "Data & Export" },
  ] },
  { label: "Plan", items: [
    { href: "/settings/billing", label: "Billing" },
    { href: "/settings/team", label: "Team" },
  ] },
];

export function SettingsNav() {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-4">
      {GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 text-[.62rem] font-semibold uppercase tracking-[.1em] text-text-3">{group.label}</div>
          {group.items.map((item) => {
            const on = path === item.href || path.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={
                  "rounded-[10px] px-3 py-2 text-sm font-medium transition-colors " +
                  (on ? "bg-brand-soft font-semibold text-brand-ink" : "text-text-2 hover:bg-surface-3 hover:text-text")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
