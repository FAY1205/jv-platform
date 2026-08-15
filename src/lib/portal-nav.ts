// Map a /portal/* route to the desktop top-bar title (the admin PageHeader pattern,
// portal-flavored). Pure + client-safe: no window/router, strips query/hash. The bare
// login/tos routes render with no chrome, so they have no title. Sections without detail
// routes (activity, devices) fall back to their section title via startsWith. The leads
// LIST route (`/portal/leads` exactly) shows "Leads" in the top bar; the leads DETAIL
// route (`/portal/leads/{ref}`) returns null because that page owns its own `<h1>`. `/portal`
// itself is the Account tab.
export function portalTitleForPath(pathname: string): string | null {
  const p = pathname.split("?")[0].split("#")[0];
  if (p === "/portal/login" || p === "/portal/tos") return null;
  if (p === "/portal/dashboard") return "Dashboard";
  if (p === "/portal/leads") return "Leads";
  if (p.startsWith("/portal/activity")) return "Activity";
  if (p.startsWith("/portal/tasks")) return "Tasks";
  if (p.startsWith("/portal/devices")) return "Devices";
  if (p === "/portal") return "Account";
  return null;
}
