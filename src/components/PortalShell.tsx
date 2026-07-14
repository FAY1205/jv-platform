"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { APP_NAME } from "@/lib/app";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { useApplyTheme } from "@/lib/preferences";
import { cn } from "@/lib/cn";
import { apiGet } from "@/lib/api";
import { portalTitleForPath } from "@/lib/portal-nav";

// PortalShell (WP-F.1/F.3, WP-PW-1) — the partner-facing chrome. Below `md` this is exactly
// the shipped mobile app: a sticky top bar (brand + notifications + theme) and a sticky
// bottom tab bar (Dashboard / Leads / Activity / Account). At `md`+ it gains an admin-style
// left rail (brand, nav, identity) and a desktop top bar (route title + tools) — one single
// render tree, `children` render ONCE, chrome variants are toggled with Tailwind breakpoint
// classes (never duplicated JSX branches). The /portal/login (pre-auth) and /portal/tos
// (post-auth, pre-ToS-acceptance) routes render bare (no chrome). The content region is a
// plain <div> so each page keeps its own single <main> landmark. Tokens only (PRN-12).

type Tab = { href: string; label: string; icon: React.ReactNode; active: (p: string) => boolean };

type MeResponse = { email: string; role: string; workspace: { name: string } };

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.85,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const TABS: Tab[] = [
  {
    href: "/portal/dashboard",
    label: "Dashboard",
    active: (p) => p === "/portal/dashboard",
    icon: <svg {...stroke} className="h-[22px] w-[22px]"><path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z" /></svg>,
  },
  {
    href: "/portal/leads",
    label: "Leads",
    active: (p) => p.startsWith("/portal/leads"),
    icon: <svg {...stroke} className="h-[22px] w-[22px]"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></svg>,
  },
  {
    href: "/portal/activity",
    label: "Activity",
    active: (p) => p.startsWith("/portal/activity"),
    icon: <svg {...stroke} className="h-[22px] w-[22px]"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  },
  {
    href: "/portal",
    label: "Account",
    active: (p) => p === "/portal" || p.startsWith("/portal/devices"),
    icon: <svg {...stroke} className="h-[22px] w-[22px]"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>,
  },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  useApplyTheme();
  const path = usePathname() ?? "";
  const bare = path === "/portal/login" || path === "/portal/tos";
  const title = portalTitleForPath(path);
  const identity = useQuery({ queryKey: ["me"], queryFn: () => apiGet<MeResponse>("/api/me"), enabled: !bare });
  if (bare) return <>{children}</>;
  const email = identity.data?.email ?? "";
  const initials = email.slice(0, 2).toUpperCase();

  const brand = (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 34 34" fill="none" aria-hidden="true" className="h-7 w-7 shrink-0">
        <rect x="1.5" y="1.5" width="31" height="31" rx="7" className="stroke-text" strokeWidth="1.5" />
        <path d="M7 24 L14 12 L21 19 L27 9" className="stroke-brand" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="24" r="2.4" className="fill-text" /><circle cx="27" cy="9" r="2.8" className="fill-brand" />
      </svg>
      <span className="font-display text-step-3 font-semibold tracking-tight text-text">{APP_NAME}</span>
    </span>
  );

  return (
    <div className="md:grid md:min-h-screen md:grid-cols-[248px_1fr]">
      {/* ===== Desktop left rail (≥ md) ===== */}
      <aside className="hidden md:flex md:sticky md:top-0 md:h-screen md:flex-col border-r border-border bg-surface px-3 py-4">
        <Link href="/portal/dashboard" className="px-2 pb-4">{brand}</Link>
        <nav aria-label="Portal" className="flex flex-col gap-1">
          {TABS.map((t) => {
            const on = t.active(path);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-step-2 font-semibold transition-colors",
                  on ? "bg-brand-soft text-brand-ink" : "text-text-2 hover:bg-surface-2 hover:text-text",
                )}
              >
                {t.icon}
                {t.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/portal" className="mt-auto flex items-center gap-3 rounded-lg border-t border-border-soft px-2 pt-3 hover:bg-surface-2">
          <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-step-1 font-bold text-brand-contrast">{initials}</span>
          <span className="min-w-0">
            <span className="block truncate text-step-1 font-semibold text-text">{email || "Account"}</span>
            <span className="block text-step-0 text-text-3">View account</span>
          </span>
        </Link>
      </aside>

      {/* ===== Content column ===== */}
      <div className="flex min-h-screen min-w-0 flex-col">
        {/* Mobile top bar (< md) — UNCHANGED from the shipped shell */}
        <header className="md:hidden sticky top-0 z-20 mx-auto flex w-full max-w-[520px] items-center gap-2 border-b border-border-soft bg-bg/85 px-4 py-2 backdrop-blur-md">
          <Link href="/portal/dashboard" className="flex items-center gap-2">{brand}</Link>
          <div className="ml-auto flex items-center gap-1"><NotificationBell /><ThemeToggle /></div>
        </header>

        {/* Desktop top bar (≥ md) — page title + tools */}
        <header className="hidden md:flex sticky top-0 z-20 items-center gap-3 border-b border-border-soft bg-bg/85 px-6 py-2 backdrop-blur-md">
          {title && <h1 className="font-display text-lg font-semibold tracking-tight text-text">{title}</h1>}
          <div className="ml-auto flex items-center gap-1"><NotificationBell /><ThemeToggle /></div>
        </header>

        {/* Page content — renders ONCE */}
        <div className="mx-auto w-full max-w-[520px] flex-1 md:max-w-[1120px]">
          {children}
        </div>

        {/* Mobile bottom tabs (< md) — UNCHANGED from the shipped shell */}
        <nav aria-label="Portal" className="md:hidden sticky bottom-0 z-20 mx-auto flex w-full max-w-[520px] border-t border-border-soft bg-bg/90 px-2 pb-2 pt-1.5 backdrop-blur-md">
          {TABS.map((t) => {
            const on = t.active(path);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-step-1 font-semibold transition-colors",
                  on ? "bg-brand-soft text-brand-ink" : "text-text-3 hover:text-text",
                )}
              >
                {t.icon}
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
