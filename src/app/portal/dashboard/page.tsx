import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance } from "@/lib/legal/tos";
import { PortalDashboard } from "./portal-dashboard";

// WP-F.3: the portal landing. Server-side ToS gate before the hero renders (mirrors the
// Account page); the partner-scoped data loads client-side via TanStack Query.
export const dynamic = "force-dynamic";

export default async function PortalDashboardPage() {
  let userId: string;
  try {
    userId = (await getServerScope()).userId;
  } catch {
    redirect("/portal/login");
  }
  const accepted = await latestTosVersion(getDb(), userId);
  if (needsTosAcceptance(accepted)) redirect("/portal/tos");

  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <PortalDashboard />
    </main>
  );
}
