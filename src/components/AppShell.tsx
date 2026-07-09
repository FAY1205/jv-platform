"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/app";
import { NotificationBell } from "./NotificationBell";

// The admin app shell (DSN): a minimal sidebar + a clean top bar. Every admin page
// renders its content inside <AppShell>; the active nav item is derived from the URL.
// All color/spacing comes from semantic tokens (PRN-12).

type IconName = "dashboard" | "runs" | "partners" | "coverage" | "analytics" | "rules" | "activity" | "settings" | "help" | "search" | "menu";

function Icon({ name }: { name: IconName }) {
  const p: Record<IconName, React.ReactNode> = {
    dashboard: (<><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>),
    runs: (<><path d="M4 6h16M4 12h16M4 18h10" /></>),
    partners: (<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 11a3.2 3.2 0 0 0 0-6" /></>),
    coverage: (<><path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Z" /><path d="M9 3v15M15 6v15" /></>),
    analytics: (<><path d="M4 20V4M4 20h16" /><rect x="7" y="12" width="3" height="5" rx="1" /><rect x="12" y="8" width="3" height="9" rx="1" /><rect x="17" y="5" width="3" height="12" rx="1" /></>),
    rules: (<><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="8" cy="5" r="1.6" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="10" cy="19" r="1.6" fill="currentColor" stroke="none" /></>),
    activity: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4l3 2" /></>),
    settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.4-1.4 1.6 1.6 0 0 0-1.8.3 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 3.7 15a2 2 0 1 1 0-4A1.6 1.6 0 0 0 5 8.6" /></>),
    help: (<><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1 .8-1 1.6" /><path d="M12 17h.01" /></>),
    search: (<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
    menu: (<><path d="M4 6h16M4 12h16M4 18h16" /></>),
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[name]}
    </svg>
  );
}

// Grouped navigation: sections keep the rail scannable and give future pages an
// obvious home (Leads and Unmatched join the "Leads" section in later phases).
interface NavItem { href: string; label: string; icon: IconName }
const NAV_SECTIONS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }] },
  { label: "Leads", items: [
    { href: "/imports", label: "Imports", icon: "runs" },
  ]},
  { label: "Network", items: [
    { href: "/partners", label: "Partners", icon: "partners" },
    { href: "/coverage", label: "Coverage", icon: "coverage" },
  ]},
  { label: "Insights", items: [
    { href: "/analytics", label: "Analytics", icon: "analytics" },
  ]},
  { label: "Admin", items: [
    { href: "/rules", label: "Rules", icon: "rules" },
    { href: "/activity", label: "Activity", icon: "activity" },
    { href: "/settings/notifications", label: "Settings", icon: "settings" },
  ]},
];

const NAV_PREF_KEY = "jv.nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  const isActive = (href: string) =>
    href === "/dashboard" ? path === "/dashboard" || path === "/" : path === href || path.startsWith(`${href}/`);

  // Sidebar state. `navOpen` = desktop collapse (persisted; each page renders
  // its own AppShell, so the choice must survive navigation). `mobileOpen` =
  // the transient overlay drawer on small screens.
  const [navOpen, setNavOpen] = React.useState(true);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- apply client-only persisted preference after mount
    setNavOpen(localStorage.getItem(NAV_PREF_KEY) !== "closed");
  }, []);

  // One viewport-aware menu button: collapses the rail on desktop, opens the
  // drawer on mobile.
  const toggleNav = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      const next = !navOpen;
      setNavOpen(next);
      localStorage.setItem(NAV_PREF_KEY, next ? "open" : "closed");
    } else {
      setMobileOpen((v) => !v);
    }
  };

  // Rail contents, shared by the desktop column and the mobile drawer.
  const rail = (onNavigate?: () => void) => (
    <>
      <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 px-2.5 pb-5">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-brand text-[.72rem] font-bold text-white shadow-[0_5px_14px_-6px_var(--brand)]">JV</span>
        <span className="font-display text-[.95rem] font-semibold tracking-tight">{APP_NAME}</span>
      </Link>
      <nav className="flex flex-col gap-0.5">
        {NAV_SECTIONS.map((section, i) => (
          <React.Fragment key={section.label ?? `s${i}`}>
            {section.label && (
              <div className="px-3 pb-1.5 pt-5 text-[.62rem] font-semibold uppercase tracking-[.1em] text-text-3">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const on = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={on ? "page" : undefined}
                  className={
                    "group flex items-center gap-3 rounded-[11px] px-3 py-2.5 text-sm font-medium transition-all duration-150 " +
                    (on
                      ? "bg-brand-soft font-semibold text-brand-strong"
                      : "text-text-2 hover:translate-x-0.5 hover:bg-surface-3 hover:text-text")
                  }
                >
                  <span
                    className={
                      "h-[18px] w-[18px] transition-transform duration-150 group-hover:scale-110 " +
                      (on ? "text-brand" : "text-text-3")
                    }
                  >
                    <Icon name={item.icon} />
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </React.Fragment>
        ))}
      </nav>
      <div className="mt-auto">
        <Link href="/dev/emails" onClick={onNavigate} className="flex items-center gap-3 rounded-[11px] px-3 py-2.5 text-sm text-text-3 transition-colors hover:bg-surface-3 hover:text-text-2">
          <span className="h-[17px] w-[17px]"><Icon name="help" /></span>
          Help &amp; guides
        </Link>
      </div>
    </>
  );

  return (
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
          <aside className="anim-drawer absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-border bg-surface px-4 py-5 shadow-lg">
            {rail(() => setMobileOpen(false))}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border-soft bg-bg/80 px-6 py-3 backdrop-blur-md md:px-7">
          <button
            type="button"
            onClick={toggleNav}
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-transparent text-text-2 transition-colors hover:border-border hover:bg-surface active:scale-95"
          >
            <span className="h-[18px] w-[18px]"><Icon name="menu" /></span>
          </button>
          <div className="flex h-9 w-full max-w-[320px] items-center gap-2.5 rounded-[11px] border border-border bg-surface px-3 text-text-3 transition-colors focus-within:border-brand-line">
            <span className="h-4 w-4"><Icon name="search" /></span>
            <input className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-3" placeholder="Search leads, partners, ZIP codes…" aria-label="Search" />
            <kbd className="num hidden rounded-[5px] border border-border px-1.5 text-[.62rem] text-text-3 sm:inline">⌘K</kbd>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <button type="button" className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2.5 transition-colors hover:bg-surface-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-[.68rem] font-semibold text-white">A</span>
              <span className="hidden text-[.78rem] font-semibold text-text-2 sm:inline">Admin</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-3" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
        </header>

        <main className="anim-fade w-full max-w-[1240px] px-6 pb-14 pt-5 md:px-8">{children}</main>
      </div>
    </div>
  );
}
