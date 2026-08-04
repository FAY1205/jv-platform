import { redirect } from "next/navigation";

// VP-4: the partner lead detail PAGE is retired in favor of the leads dialog (parity with
// the admin P-1 change). Kept as a redirect so already-sent "lead assigned" notifications
// and any bookmarked /portal/leads/<ref> URLs still land — the dialog auto-opens from
// ?open=<ref> on the leads list.
export const dynamic = "force-dynamic";

export default async function PortalLeadRedirect({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  redirect(`/portal/leads?open=${encodeURIComponent(ref)}`);
}
