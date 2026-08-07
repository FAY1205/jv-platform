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
    { href: "/settings/workspace", label: "Workspace" },
    { href: "/settings/notifications", label: "Notifications" },
    { href: "/settings/security", label: "Security" },
    { href: "/settings/appearance", label: "Appearance" },
  ] },
  { label: "Organization", items: [
    { href: "/settings/data", label: "Data & Export" },
    { href: "/settings/billing", label: "Billing" },
    { href: "/settings/ai", label: "AI assistant" },
    { href: "/settings/team", label: "Team" },
  ] },
];

export function SettingsNav({ isPlatformOwner = false }: { isPlatformOwner?: boolean }) {
  const path = usePathname() ?? "";
  // SCP-07: the owner-only Invitations item appears only for platform owners
  // (ADMIN_ALLOWLIST). The flag is resolved server-side in the settings layout; the
  // route re-checks, so this only hides the link.
  const groups = isPlatformOwner
    ? [...GROUPS, { label: "Platform", items: [{ href: "/settings/invitations", label: "Invitations" }] }]
    : GROUPS;
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 text-step-1 font-semibold uppercase tracking-[.08em] text-text-3">{group.label}</div>
          {group.items.map((item) => {
            const on = path === item.href || path.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors " +
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
