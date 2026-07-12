"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/app";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { useApplyTheme } from "@/lib/preferences";
import { cn } from "@/lib/cn";

// PortalShell (WP-F.1/F.3) — the partner-facing mobile chrome: a sticky top bar (brand +
// notifications + theme) and a sticky bottom tab bar (Dashboard / Leads / Activity / Account). A
// centered ≤520px column reads like an app on desktop and full-bleed on mobile. The
// /portal/login (pre-auth) and /portal/tos (post-auth, pre-ToS-acceptance) routes render
// bare (no chrome). The content region is a plain <div> so each page keeps its own single
// <main> landmark. Tokens only (PRN-12).

type Tab = { href: string; label: string; icon: React.ReactNode; active: (p: string) => boolean };

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
  if (bare) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[520px] flex-col border-border bg-bg md:border-x">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border-soft bg-bg/85 px-4 py-3 backdrop-blur-md">
        <Link href="/portal/dashboard" className="flex items-center gap-2">
          <svg viewBox="0 0 34 34" fill="none" aria-hidden="true" className="h-7 w-7 shrink-0">
            <rect x="1.5" y="1.5" width="31" height="31" rx="7" className="stroke-text" strokeWidth="1.5" />
            <path d="M7 24 L14 12 L21 19 L27 9" className="stroke-brand" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="7" cy="24" r="2.4" className="fill-text" />
            <circle cx="27" cy="9" r="2.8" className="fill-brand" />
          </svg>
          <span className="font-display text-step-3 font-semibold tracking-tight text-text">{APP_NAME}</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <nav aria-label="Portal" className="sticky bottom-0 z-20 flex border-t border-border-soft bg-bg/90 px-2 pb-2 pt-1.5 backdrop-blur-md">
        {TABS.map((t) => {
          const on = t.active(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                // Active tab carries a bg pill + color (never color alone — PRN-14).
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
  );
}
