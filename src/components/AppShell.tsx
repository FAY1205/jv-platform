"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { APP_NAME } from "@/lib/app";
import { NotificationBell } from "./NotificationBell";
import { ProfileMenu } from "./ProfileMenu";
import { PageHeaderProvider, PageHeaderSlot } from "./PageHeader";
import { ThemeToggle } from "./ThemeToggle";
import { ToastProvider } from "./Toast";
import { IconButton } from "./IconButton";
import { NavIcon, type NavIconName } from "./NavIcon";
import { usePreferences, setPreferences, useApplyTheme } from "@/lib/preferences";

// The admin app shell (DSN): a minimal sidebar + a clean top bar. Every admin page
// renders its content inside <AppShell>; the active nav item is derived from the URL.
// All color/spacing comes from semantic tokens (PRN-12).
//
// ADR-0030: the shell owns the ToastProvider, so no admin page has to mount one. useToast
// is reachable from shared leaves (LeadDialog, StatusSelect) that a page composes without
// any signal it has taken on a provider requirement — leaving the mount to pages shipped
// /imports/[ref] and /partners/[id] broken. Pages must NOT nest a second provider: it
// would render a duplicate live region and double-announce.

type IconName = NavIconName;

// Grouped navigation: sections keep the rail scannable and give future pages an
// obvious home (Leads and Unmatched join the "Leads" section in later phases).
interface NavItem { href: string; label: string; icon: IconName; badge?: "leads" | "unmatched" }
// Grouped by the weekly job (audit F-63): Route = today's work, Review = the queue,
// Network = who/where, Admin = configuration. Exported for the shell nav test.
export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  { label: "Route", items: [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/leads", label: "Leads", icon: "leads", badge: "leads" },
    { href: "/tasks", label: "Tasks", icon: "tasks" },
  ]},
  { label: "Review", items: [
    { href: "/unmatched", label: "Unmatched", icon: "unmatched", badge: "unmatched" },
    { href: "/imports", label: "Imports", icon: "runs" },
  ]},
  { label: "Network", items: [
    { href: "/partners", label: "Partners", icon: "partners" },
    { href: "/coverage", label: "Coverage", icon: "coverage" },
  ]},
  { label: "Admin", items: [
    { href: "/rules", label: "Rules", icon: "rules" },
    { href: "/activity", label: "Activity", icon: "activity" },
    { href: "/settings", label: "Settings", icon: "settings" },
  ]},
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  const isActive = (href: string) =>
    href === "/dashboard" ? path === "/dashboard" || path === "/" : path === href || path.startsWith(`${href}/`);

  // Sidebar state. Desktop collapse is a persisted UI preference (the one small prefs
  // store — survives navigation since each page mounts its own AppShell). `mobileOpen`
  // is the transient overlay drawer on small screens.
  const { navCollapsed } = usePreferences();
  const navOpen = !navCollapsed;
  const [mobileOpen, setMobileOpen] = React.useState(false);
  useApplyTheme(); // keep <html data-theme> in sync with the theme preference (WS-7 Appearance)

  // F-70: the mobile drawer behaves as a modal — Escape closes it, focus moves into the
  // drawer on open and returns to the menu button on close.
  const menuBtnRef = React.useRef<HTMLButtonElement>(null);
  const drawerRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!mobileOpen) return;
    const opener = menuBtnRef.current;
    drawerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [mobileOpen]);

  // One viewport-aware menu button: collapses the rail on desktop, opens the
  // drawer on mobile.
  const toggleNav = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setPreferences({ navCollapsed: navOpen }); // currently open ⇒ collapse, and vice-versa
    } else {
      setMobileOpen((v) => !v);
    }
  };

  // Nav-badge counts — cheap, cached across pages, from the server (PRN-15, never derived).
  const unmatched = useQuery({
    queryKey: ["unmatched", "count"],
    queryFn: () => apiGet<{ count: number }>("/api/leads/unmatched/count"),
    staleTime: 30_000,
  });
  const unmatchedCount = unmatched.data?.count ?? 0;
  const leads = useQuery({
    queryKey: ["leads", "count"],
    queryFn: () => apiGet<{ count: number }>("/api/leads/count"),
    staleTime: 30_000,
  });
  const leadsTotal = leads.data?.count ?? 0;

  // Rail contents, shared by the desktop column and the mobile drawer.
  const rail = (onNavigate?: () => void) => (
    <>
      <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 px-2 pb-5">
        <svg viewBox="0 0 34 34" fill="none" aria-hidden="true" className="h-[30px] w-[30px] shrink-0">
          <rect x="1.5" y="1.5" width="31" height="31" rx="7" className="stroke-text" strokeWidth="1.5" />
          <path d="M7 24 L14 12 L21 19 L27 9" className="stroke-brand" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="7" cy="24" r="2.4" className="fill-text" />
          <circle cx="27" cy="9" r="2.8" className="fill-brand" />
        </svg>
        <span className="min-w-0">
          <span className="block truncate font-display text-step-3 font-semibold leading-tight tracking-tight">{APP_NAME}</span>
          <span className="block text-step-1 leading-tight text-text-3">Operations</span>
        </span>
      </Link>
      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {NAV_SECTIONS.map((section, i) => (
          <React.Fragment key={section.label}>
            <div className={"px-3 pb-1.5 text-step-1 font-semibold uppercase tracking-[.08em] text-text-3 " + (i === 0 ? "pt-1" : "pt-5")}>
              {section.label}
            </div>
            {section.items.map((item) => {
              const on = isActive(item.href);
              // D2 (SC 4.1.2 polish): the count belongs to the LINK's accessible name
              // ("Leads, 412"), not the badge's — a badge-level aria-label composed the
              // redundant "Leads 412 leads". The badge is aria-hidden (its number is
              // carried by the link name).
              const badgeCount = item.badge === "unmatched" ? unmatchedCount : item.badge === "leads" ? leadsTotal : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={on ? "page" : undefined}
                  aria-label={badgeCount > 0 ? `${item.label}, ${badgeCount.toLocaleString()}` : undefined}
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
                    <NavIcon name={item.icon} className="h-[18px] w-[18px]" />
                  </span>
                  {item.label}
                  {item.badge === "unmatched" && unmatchedCount > 0 && (
                    <span className="num ml-auto rounded-full bg-warn-soft px-1.5 py-0.5 text-step-1 font-semibold text-warn" aria-hidden="true">
                      {unmatchedCount}
                    </span>
                  )}
                  {item.badge === "leads" && leadsTotal > 0 && (
                    <span className="num ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 text-step-1 font-semibold text-text-2" aria-hidden="true">
                      {leadsTotal.toLocaleString()}
                    </span>
                  )}
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </nav>
      <div className="mt-auto border-t border-border-soft pt-2">
        <ProfileMenu />
      </div>
    </>
  );

  return (
    <ToastProvider>
      <PageHeaderProvider>
      <div className={"grid min-h-screen grid-cols-1 " + (navOpen ? "md:grid-cols-[236px_1fr]" : "md:grid-cols-1")}>
      {/* Desktop rail — a grid column, collapsible, pinned while content scrolls. */}
      <aside
        className={
          "flex-col border-r border-border px-4 py-5 md:sticky md:top-0 md:h-screen " +
          (navOpen ? "hidden md:flex" : "hidden")
        }
      >
        {rail()}
      </aside>

      {/* Mobile drawer — fixed overlay with a scrim; tap-away or nav-tap closes it. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="anim-scrim absolute inset-0"
            style={{ background: "var(--scrim)" }}
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="anim-drawer absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-border bg-surface px-4 py-5 shadow-lg outline-none"
          >
            {rail(() => setMobileOpen(false))}
          </aside>
        </div>
      )}

      {/* F-70: while the mobile drawer is open, the rest of the app is inert — Tab can't
          leave the drawer and screen readers skip the covered content (true modal). */}
      <div className="flex min-w-0 flex-col" inert={mobileOpen}>
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border-soft bg-bg/80 px-6 py-2 backdrop-blur-md md:px-7">
          <IconButton
            ref={menuBtnRef}
            onClick={toggleNav}
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
          >
            <NavIcon name="menu" className="h-[18px] w-[18px]" />
          </IconButton>
          <PageHeaderSlot />
          <div className="ml-auto flex items-center gap-1.5">
            <NotificationBell />
            <ThemeToggle />
          </div>
        </header>

        <main className="anim-fade w-full max-w-[1240px] px-6 pb-14 pt-5 md:px-8">{children}</main>
      </div>
      </div>
      </PageHeaderProvider>
    </ToastProvider>
  );
}
