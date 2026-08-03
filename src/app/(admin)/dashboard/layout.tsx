import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { needsTosGate } from "@/lib/auth/tos-guard";

// LGL-01 (WP-SU-5b): the ADMIN entry gate. /dashboard is where an admin lands (the root
// redirect sends them here), so gating it means a self-serve admin who must re-accept is
// routed to /tos before using the app — mirroring the portal's landing gate.
//
// A server LAYOUT rather than the page, because the dashboard page is a client component
// and cannot do this check itself. The admin app has no shared layout of its own (the
// (admin) route group is an empty placeholder), so full app-wide gating would mean touching
// every admin page or restructuring routes — disproportionate here. The entry gate plus the
// API guard (requireTosResponse, already wired into the shared data routes) covers the
// realistic paths; widening it is a follow-up if the ToS ever needs to block every screen.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  try {
    const scope = await getServerScope();
    if (await needsTosGate(getDb(), scope)) redirect("/tos");
  } catch (e) {
    // redirect() signals by throwing — never swallow it. An auth failure is the proxy's
    // job to handle (it redirects to /login), so anything else falls through to the page.
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    if (typeof e === "object" && e !== null && "digest" in e) throw e;
  }
  return <>{children}</>;
}
