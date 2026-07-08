import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance } from "@/lib/legal/tos";
import { Card, CardBody, CardHeader, CardTitle } from "@/components";

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
      <Card>
        <CardHeader>
          <CardTitle>Partner portal</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-text-2">
            You&apos;re signed in. Your leads, statuses, and notes will appear here.
          </p>
        </CardBody>
      </Card>
    </main>
  );
}
