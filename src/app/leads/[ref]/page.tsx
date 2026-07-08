import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerScope } from "@/lib/scope-context";
import { getPartnerLeadDetail } from "@/modules/portal/queries";
import { Card, CardBody, CardHeader, CardTitle, Badge, NotesPanel } from "@/components";

// Admin lead detail — a per-lead view for the admin (the run tables only list them).
// Reuses the scoped detail query (admin scope sees the whole tenant) and hosts the
// admin note stream (PRN-13). Admin-only.
export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-3">{label}</span>
      <span className="text-sm text-text-2">{value || "—"}</span>
    </div>
  );
}

export default async function AdminLeadPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const scope = await getServerScope().catch(() => null);
  if (!scope) redirect("/login");
  if (scope.role !== "admin") redirect("/portal");

  const detail = await getPartnerLeadDetail(scope, ref);
  if (!detail) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <Link href="/runs" className="mb-4 inline-block text-sm text-text-3 hover:text-text-2">
        ← Back to runs
      </Link>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>
              <span className="font-mono">{detail.refId}</span>
            </CardTitle>
            <Badge>{detail.status}</Badge>
          </CardHeader>
          <CardBody className="grid grid-cols-2 gap-4">
            <Field label="Seller" value={`${detail.seller.first} ${detail.seller.last}`.trim()} />
            <Field label="Received" value={new Date(detail.receivedAt).toLocaleString()} />
            <Field label="Phone" value={detail.seller.phone} />
            <Field label="Email" value={detail.seller.email} />
            <Field label="Property" value={`${detail.address}, ${detail.city} ${detail.state} ${detail.zip}`.trim()} />
            <Field label="Reason for selling" value={detail.reasonForSelling} />
          </CardBody>
        </Card>

        <NotesPanel leadRef={ref} title="Admin notes" />
      </div>
    </main>
  );
}
