import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance } from "@/lib/legal/tos";
import { PortalAccount } from "./portal-account";

// PTL-01: partner portal "Account" tab. Server-side ToS gate — a partner cannot reach the
// portal without accepting the current ToS. Identity + sign-out live in PortalAccount.
export const dynamic = "force-dynamic";

export default async function PortalHome() {
  let userId: string;
  try {
    userId = (await getServerScope()).userId;
  } catch {
    // P-11: preserve the target like the proxy does, so a secondary scope failure returns
    // the partner here after re-auth instead of dumping them on the default landing.
    redirect("/portal/login?next=/portal");
  }

  const accepted = await latestTosVersion(getDb(), userId);
  if (needsTosAcceptance(accepted)) redirect("/portal/tos");

  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text md:hidden">Your account</h1>
      <PortalAccount />
    </main>
  );
}
