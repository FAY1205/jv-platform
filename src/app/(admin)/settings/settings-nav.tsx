"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import type { Capability } from "@/lib/authz";

// WS-7: the Settings hub left-nav. Grouped sections (Account / Workspace / Plan) under
// /settings; the active item is derived from the URL. Sections fill in across the WS-7
// slices; Billing + Team are intentional stubs (member role + billing come later).

// WP-UX-7 (audit TM-1): `soon` marks a nav item that leads to a "coming soon" placeholder,
// so the label carries a quiet pill and the destination isn't a surprise after the click.
//
// Phase C: `requires` marks the ONE whole-route exception to the disable-don't-hide rule
// (team-page-spec §6) — a page the role can never use hides its nav entry (the route itself
// redirects). Everything else stays visible and degrades in place.
interface NavItem { href: string; label: string; soon?: boolean; requires?: Capability }
const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Account", items: [
    { href: "/settings/profile", label: "Profile" },
    { href: "/settings/workspace", label: "Workspace" },
    { href: "/settings/notifications", label: "Notifications" },
    { href: "/settings/security", label: "Security" },
    { href: "/settings/appearance", label: "Appearance" },
  ] },
  { label: "Organization", items: [
    // TAG-06: the tag manager sits with the other workspace-wide data settings.
    { href: "/settings/tags", label: "Tags" },
    { href: "/settings/data", label: "Data & Export" },
    { href: "/settings/billing", label: "Billing", soon: true },
    { href: "/settings/ai", label: "AI assistant" },
    { href: "/settings/team", label: "Team", requires: "team.manage" },
  ] },
];

export function SettingsNav({ isPlatformOwner = false }: { isPlatformOwner?: boolean }) {
  const path = usePathname() ?? "";
  const { canDo } = useCurrentUser();
  // SCP-07: the owner-only Invitations item appears only for platform owners
  // (ADMIN_ALLOWLIST). The flag is resolved server-side in the settings layout; the
  // route re-checks, so this only hides the link.
  const withPlatform = isPlatformOwner
    ? [...GROUPS, { label: "Platform", items: [{ href: "/settings/invitations", label: "Invitations" }] }]
    : GROUPS;
  const groups = withPlatform
    .map((g) => ({ ...g, items: g.items.filter((i: NavItem) => !i.requires || canDo(i.requires)) }))
    .filter((g) => g.items.length > 0);
  const isOn = (item: NavItem) => path === item.href || path.startsWith(`${item.href}/`);

  return (
    <nav aria-label="Settings sections">
      {/* WP-UX-5 (audit S-1 — the series' one CRITICAL): below `lg` the grouped sidebar
          used to linearize ABOVE the content — ~1,100px of nav before the first card on
          every settings visit. Narrow widths get a horizontally scrollable pill strip
          instead; the grouped sidebar stays on `lg+` untouched. One item list, two
          renders — the strips can never drift apart. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2 lg:hidden" role="list">
        {groups.flatMap((g) => g.items).map((item) => {
          const on = isOn(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={
                "whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors " +
                (on
                  ? "border-brand bg-brand-soft font-semibold text-brand-ink"
                  : "border-border bg-surface text-text-2 hover:border-brand-line hover:text-text")
              }
            >
              {item.label}
              {item.soon && <SoonPill />}
            </Link>
          );
        })}
      </div>

      <div className="hidden flex-col gap-4 lg:flex">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div className="px-3 pb-1 text-step-1 font-semibold uppercase tracking-[.08em] text-text-3">{group.label}</div>
            {group.items.map((item) => {
              const on = isOn(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors " +
                    (on ? "bg-brand-soft font-semibold text-brand-ink" : "text-text-2 hover:bg-surface-3 hover:text-text")
                  }
                >
                  {item.label}
                  {item.soon && <SoonPill />}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

/** WP-UX-7 (audit TM-1): a quiet "Soon" marker on a stub nav item. */
function SoonPill() {
  return (
    <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-text-3">
      Soon
    </span>
  );
}
