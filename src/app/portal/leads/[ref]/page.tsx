"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, CardHeader, CardTitle, Select, Badge, Skeleton, NotesPanel, ListingBadge } from "@/components";

interface LeadDetail {
  refId: string;
  seller: { first: string; last: string; phone: string; email: string };
  address: string;
  city: string;
  state: string;
  zip: string;
  reasonForSelling: string;
  motivation: string;
  timeToSell: string;
  notes: string;
  receivedAt: string;
  previouslyMatched: boolean;
  status: string;
  history: { status: string; changedAt: string }[];
  availableStatuses: string[];
  listing: { status: "pending" | "yes" | "no" | "unknown"; link: string | null };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-3">{label}</span>
      <span className="text-sm text-text-2">{value || "—"}</span>
    </div>
  );
}

export default function PortalLeadDetailPage() {
  const params = useParams();
  const ref = String(params.ref);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["portal-lead", ref],
    queryFn: () => apiGet<LeadDetail>(`/api/portal/leads/${ref}`),
  });

  const update = useMutation({
    mutationFn: async (status: string) => {
      const res = await fetch(`/api/portal/leads/${ref}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(b?.message ?? "Could not update the status.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-lead", ref] }),
  });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <Link href="/portal/leads" className="mb-4 inline-block text-sm text-text-3 hover:text-text-2">
        ← Back to your leads
      </Link>

      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>
                <span className="font-mono">{data.refId}</span>
              </CardTitle>
              <Badge>{data.status}</Badge>
            </CardHeader>
            <CardBody className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Seller" value={`${data.seller.first} ${data.seller.last}`.trim()} />
                <Field label="Received" value={new Date(data.receivedAt).toLocaleString()} />
                <Field label="Phone" value={data.seller.phone} />
                <Field label="Email" value={data.seller.email} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Property" value={`${data.address}, ${data.city} ${data.state} ${data.zip}`.trim()} />
                <Field label="Reason for selling" value={data.reasonForSelling} />
                <Field label="Motivation" value={data.motivation} />
                <Field label="Time to sell" value={data.timeToSell} />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-3">Listing check</span>
                <ListingBadge status={data.listing.status} link={data.listing.link} />
              </div>

              {data.notes && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-3">Notes</span>
                  <p className="whitespace-pre-wrap text-sm text-text-2">{data.notes}</p>
                </div>
              )}

              <div className="max-w-xs">
                <Select
                  label="Status"
                  value={data.status}
                  disabled={update.isPending}
                  error={update.isError ? (update.error as Error).message : undefined}
                  options={data.availableStatuses.map((s) => ({ value: s, label: s }))}
                  onChange={(e) => {
                    if (e.target.value !== data.status) update.mutate(e.target.value);
                  }}
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status history</CardTitle>
            </CardHeader>
            <CardBody>
              {data.history.length === 0 ? (
                <p className="text-sm text-text-3">No changes yet — the current status is the default.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {data.history.map((h, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <Badge>{h.status}</Badge>
                      <span className="font-mono text-xs text-text-3">{new Date(h.changedAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          <NotesPanel leadRef={ref} title="Your notes" />
        </div>
      )}
    </main>
  );
}
