import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance } from "@/lib/legal/tos";
import { Card, CardBody, CardHeader, CardTitle, NotificationBell } from "@/components";

// PTL-01: partner portal landing. Server-side ToS gate — a partner cannot reach the
// portal without accepting the current ToS. The scoped leads/statuses/notes views
// land in WP-026; this is the authenticated placeholder.
export const dynamic = "force-dynamic";

export default async function PortalHome() {
  let userId: string;
  try {
    userId = (await getServerScope()).userId;
  } catch {
    redirect("/portal/login");
  }

  const accepted = await latestTosVersion(getDb(), userId);
  if (needsTosAcceptance(accepted)) redirect("/portal/tos");

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold text-text">Your portal</h1>
        <NotificationBell />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Partner portal</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-5 text-sm text-text-2">You&apos;re signed in. Manage your leads and devices below.</p>
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/portal/leads"
              className="rounded-md border border-border bg-surface p-4 transition-colors hover:border-text-3 hover:bg-surface-2"
            >
              <span className="block text-sm font-semibold text-text">Your leads</span>
              <span className="block text-xs text-text-3">View, update statuses, and export</span>
            </Link>
            <Link
              href="/portal/devices"
              className="rounded-md border border-border bg-surface p-4 transition-colors hover:border-text-3 hover:bg-surface-2"
            >
              <span className="block text-sm font-semibold text-text">Your devices</span>
              <span className="block text-xs text-text-3">Remembered browsers you can sign out</span>
            </Link>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
