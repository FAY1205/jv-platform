import { redirect } from "next/navigation";

// P-1 (portal-parity audit): this page used to be a read-only lead view with no status
// control or history — a dead end for the status-change notification that deep-linked here.
// It is retired in favor of the full leads dialog. Kept as a redirect so already-sent
// notifications and AI citations that carry the old /leads/<ref> URL still land on the
// capable surface (the dialog auto-opens from ?open=<ref>).
export const dynamic = "force-dynamic";

export default async function AdminLeadRedirect({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  redirect(`/leads?open=${encodeURIComponent(ref)}`);
}
