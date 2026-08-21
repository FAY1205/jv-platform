import type { NavIconName } from "@/components/NavIcon";

// The admin app's navigation vocabulary — WHERE you can go, grouped by the weekly job
// (audit F-63): Route = today's work, Review = the queue, Network = who/where, Admin =
// configuration.
//
// It lives in lib rather than in AppShell because it now has TWO consumers: the sidebar
// rail, and the Ctrl-K palette's "Go to" group (N6-71). The palette is mounted outside the
// shell and the shell's topbar renders the palette's trigger, so importing one from the
// other would be a module cycle — and a second, hand-kept copy of the destinations is
// exactly the drift N6-71 says to avoid ("import the constant; no duplication").
//
// Deliberately NOT capability-filtered: the sidebar shows every section to every admin seat
// and lets the destination itself refuse, so the palette matches it. A menu that silently
// omits a page teaches the operator the page does not exist.

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  badge?: "leads" | "unmatched";
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
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
