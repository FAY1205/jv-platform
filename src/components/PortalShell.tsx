"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { APP_NAME } from "@/lib/app";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { IconButton } from "./IconButton";
import { NavIcon, type NavIconName } from "./NavIcon";
import { PortalProfileMenu } from "./PortalProfileMenu";
import { ToastProvider } from "./Toast";
import { useApplyTheme, usePreferences, setPreferences } from "@/lib/preferences";
import { cn } from "@/lib/cn";
import { apiGet } from "@/lib/api";
import { portalTitleForPath } from "@/lib/portal-nav";

// PortalShell (WP-F.1/F.3, WP-PW-1, T7a) — the partner-facing chrome. Below `md` this is
// exactly the shipped mobile app: a sticky top bar (brand + notifications + theme) and a
// sticky bottom tab bar (Dashboard / Leads / Activity / Account). At `md`+ it is the admin
// AppShell, portal-flavored (T7a owner note #10): the same 236px collapsible rail metrics,
// nav-item recipe, group label, live Leads count badge, ProfileMenu-pattern rail foot, and
// the admin content-column geometry (left-aligned max-w-[1240px], px-8/pt-5/pb-14 — portal
// pages drop their own padding at md via `md:p-0`). One single render tree: `children`
// render ONCE, chrome variants are toggled with Tailwind breakpoint classes (never
// duplicated JSX branches). The /portal/login (pre-auth) and /portal/tos (post-auth,
// pre-ToS-acceptance) routes render bare (no chrome). The content region is a plain <div>
// so each page keeps its own single <main> landmark. Tokens only (PRN-12).

// VP-1: nav glyphs come from the shared NavIcon module (identical to the admin rail); the
// SIZE is set at the call site — 18px in the desktop rail, 22px in the mobile bottom tabs.
type Tab = {
  href: string;
  label: string;
  icon: NavIconName;
  active: (p: string) => boolean;
  badge?: boolean;
};

const TABS: Tab[] = [
  { href: "/portal/dashboard", label: "Dashboard", icon: "dashboard", active: (p) => p === "/portal/dashboard" },
  { href: "/portal/leads", label: "Leads", icon: "leads", badge: true, active: (p) => p.startsWith("/portal/leads") },
  { href: "/portal/activity", label: "Activity", icon: "activity", active: (p) => p.startsWith("/portal/activity") },
  // WP-TSK-5 (TSK-07): the 5th bottom tab / rail item — My Tasks, portal-scoped.
  { href: "/portal/tasks", label: "Tasks", icon: "tasks", active: (p) => p.startsWith("/portal/tasks") },
  { href: "/portal", label: "Account", icon: "account", active: (p) => p === "/portal" || p.startsWith("/portal/devices") },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  useApplyTheme();
  const path = usePathname() ?? "";
  const bare = path === "/portal/login" || path === "/portal/tos";
  const title = portalTitleForPath(path);
  // Desktop rail collapse — the portal's OWN persisted preference (D4): one person
  // driving admin + portal in the same browser (the owner's testing setup) shouldn't
  // collapse both rails with one click. Admin keeps `navCollapsed`.
  const { navCollapsedPortal } = usePreferences();
  const navOpen = !navCollapsedPortal;
  // Nav badge count (mirrors the admin rail badges) — cheap, cached, from the scoped
  // count endpoint (PRN-15: never derived client-side from a page of rows).
  const leadsCount = useQuery({
    queryKey: ["portal-leads", "count"],
    queryFn: () => apiGet<{ count: number }>("/api/portal/leads/count"),
    staleTime: 30_000,
    enabled: !bare,
  });
  if (bare) return <>{children}</>;
  const count = leadsCount.data?.count ?? 0;

  // Mobile top-bar brand — UNCHANGED from the shipped shell (the desktop rail below
  // carries its own admin-metric brand block with the "Partner portal" descriptor).
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
    // P-3 (portal-parity audit): the portal shell mounts ToastProvider like AppShell
    // (ADR-0030) so portal pages get the same success/failure toast pattern the admin
    // trains — and no shared leaf calling useToast() can crash here. Bare routes
    // (login/tos) render outside the shell, exactly as their admin counterparts do.
    <ToastProvider>
    <div className={cn("md:min-h-screen", navOpen ? "md:grid md:grid-cols-[236px_1fr]" : "md:grid md:grid-cols-1")}>
      {/* ===== Desktop left rail (≥ md) — admin AppShell metrics (T7a) ===== */}
      <aside
        className={cn(
          "border-r border-border px-4 py-5 md:sticky md:top-0 md:h-screen",
          navOpen ? "hidden md:flex md:flex-col" : "hidden",
        )}
      >
        <Link href="/portal/dashboard" className="flex items-center gap-2.5 px-2 pb-5">
          <svg viewBox="0 0 34 34" fill="none" aria-hidden="true" className="h-[30px] w-[30px] shrink-0">
            <rect x="1.5" y="1.5" width="31" height="31" rx="7" className="stroke-text" strokeWidth="1.5" />
            <path d="M7 24 L14 12 L21 19 L27 9" className="stroke-brand" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="7" cy="24" r="2.4" className="fill-text" />
            <circle cx="27" cy="9" r="2.8" className="fill-brand" />
          </svg>
          <span className="min-w-0">
            <span className="block truncate font-display text-step-3 font-semibold leading-tight tracking-tight">{APP_NAME}</span>
            <span className="block text-step-1 leading-tight text-text-3">Partner portal</span>
          </span>
        </Link>
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          <div className="px-3 pb-1.5 pt-1 text-step-1 font-semibold uppercase tracking-[.08em] text-text-3">Portal</div>
          {/* Owner call (T7a): NO "Account" item in the DESKTOP rail — like the admin rail,
              account destinations live only in the PortalProfileMenu foot below. The mobile
              bottom tabs keep the full TABS list (they have no equivalent menu). */}
          {TABS.filter((t) => t.href !== "/portal").map((t) => {
            const on = t.active(path);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                // D2 (SC 4.1.2 polish, matches AppShell): the count lives on the LINK's
                // accessible name; the badge below is aria-hidden.
                aria-label={t.badge && count > 0 ? `${t.label}, ${count.toLocaleString()}` : undefined}
                className={
                  "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150 " +
                  (on
                    ? "bg-brand-soft font-semibold text-brand-ink"
                    : "text-text-2 hover:translate-x-0.5 hover:bg-surface-3 hover:text-text")
                }
              >
                <span
                  className={
                    "transition-transform duration-150 group-hover:scale-110 " +
                    (on ? "text-brand-ink" : "text-text-3")
                  }
                >
                  <NavIcon name={t.icon} className="h-[18px] w-[18px]" />
                </span>
                {t.label}
                {t.badge && count > 0 && (
                  <span className="num ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 text-step-1 font-semibold text-text-2" aria-hidden="true">
                    {count.toLocaleString()}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-border-soft pt-2">
          <PortalProfileMenu />
        </div>
      </aside>

      {/* ===== Content column ===== */}
      <div className="flex min-h-screen min-w-0 flex-col">
        {/* Mobile top bar (< md) — UNCHANGED from the shipped shell */}
        <header className="md:hidden sticky top-0 z-20 mx-auto flex w-full max-w-[520px] items-center gap-2 border-b border-border-soft bg-bg/80 px-4 py-2 backdrop-blur-md">
          <Link href="/portal/dashboard" className="flex items-center gap-2">{brand}</Link>
          <div className="ml-auto flex items-center gap-1"><NotificationBell /><ThemeToggle /></div>
        </header>

        {/* Desktop top bar (≥ md) — collapse toggle + page title + tools (admin recipe) */}
        <header className="hidden md:flex sticky top-0 z-20 items-center gap-3 border-b border-border-soft bg-bg/80 px-7 py-2 backdrop-blur-md">
          <IconButton
            onClick={() => setPreferences({ navCollapsedPortal: navOpen })}
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
          >
            <NavIcon name="menu" className="h-[18px] w-[18px]" />
          </IconButton>
          {title && <h1 className="truncate font-display text-lg font-semibold tracking-tight text-text">{title}</h1>}
          <div className="ml-auto flex items-center gap-1.5"><NotificationBell /><ThemeToggle /></div>
        </header>

        {/* Page content — renders ONCE. < md: the shipped centered 520px column; ≥ md: the
            admin main geometry (left-aligned max-w-[1240px], px-8/pt-5/pb-14 — portal page
            <main>s drop their own mobile p-4 via md:p-0). INTENTIONAL parity exception #4:
            no admin `anim-fade` here — this wrapper renders on BOTH breakpoints and the
            shipped mobile column has no entrance fade (mobile stays untouched, T7a scope). */}
        <div className="mx-auto w-full max-w-[520px] flex-1 md:mx-0 md:max-w-[1240px] md:px-8 md:pb-14 md:pt-5">
          {children}
        </div>

        {/* Mobile bottom tabs (< md) — UNCHANGED from the shipped shell */}
        <nav aria-label="Portal" className="md:hidden sticky bottom-0 z-20 mx-auto flex w-full max-w-[520px] border-t border-border-soft bg-bg/90 px-2 pb-2 pt-1.5 backdrop-blur-md">
          {TABS.map((t) => {
            const on = t.active(path);
            const showBadge = t.badge && count > 0;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                // P-5: the Leads count reaches phones too (the desktop rail already shows it).
                // The count composes into the accessible name; the corner badge is aria-hidden.
                aria-label={showBadge ? `${t.label}, ${count.toLocaleString()}` : undefined}
                className={cn(
                  "flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-step-1 font-semibold transition-colors",
                  on ? "bg-brand-soft text-brand-ink" : "text-text-3 hover:text-text",
                )}
              >
                <span className="relative">
                  <NavIcon name={t.icon} className="h-[22px] w-[22px]" />
                  {showBadge && (
                    <span
                      className="num absolute -right-2.5 -top-1.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-brand px-1 text-[.6rem] font-bold leading-none text-brand-contrast"
                      aria-hidden="true"
                    >
                      {count > 99 ? "99+" : count.toLocaleString()}
                    </span>
                  )}
                </span>
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
    </ToastProvider>
  );
}
