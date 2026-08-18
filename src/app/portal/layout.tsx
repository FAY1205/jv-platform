import * as React from "react";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components";
import { getServerScope } from "@/lib/scope-context";
import { isPartnerStream } from "@/lib/scope";

// WP-F.1: every /portal/* page renders inside the mobile PortalShell (top bar + bottom
// tabs). The shell itself renders bare on the pre-auth login/tos routes.
// Parity #4: an authenticated ADMIN who lands on a portal URL is sent to the admin
// dashboard — the portal's partner-scoped queries would only render them empties.
// Signed-out visitors fall through so /portal/login stays reachable.
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  let staff = false;
  try {
    const scope = await getServerScope();
    // Any admin-STREAM tier (admin/member/viewer) belongs in the admin app — without this,
    // a member landing on a portal URL would get an empty partner-shaped shell (Phase C).
    staff = !isPartnerStream(scope);
  } catch (e) {
    // redirect() signals by throwing — never swallow it; auth failures fall through.
    if (typeof e === "object" && e !== null && "digest" in e) throw e;
  }
  if (staff) redirect("/dashboard");
  return <PortalShell>{children}</PortalShell>;
}
