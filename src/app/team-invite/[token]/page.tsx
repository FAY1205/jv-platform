import type { Metadata } from "next";
import { APP_NAME } from "@/lib/app";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: `Accept your invite — ${APP_NAME}` };

// Phase C: the PUBLIC landing page for an emailed staff invite (no session yet). The token is
// a path segment so the link works from any mail client; the server never exposes invite
// metadata to an unauthenticated GET, so this page stays deliberately generic — it names no
// workspace, no inviter, and no invitee address until the password is accepted.
export default async function TeamInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInviteForm token={token} />;
}
