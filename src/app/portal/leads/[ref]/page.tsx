"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, CardHeader, CardTitle, NativeSelect, Badge, Skeleton, EmptyState, NotesPanel, ListingBadge, Spinner, useToast } from "@/components";

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
  const toast = useToast();

  const { data, isLoading, error } = useQuery({
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
      return status;
    },
    // P-3: confirm the save like the admin StatusSelect does, plus keep the count badge
    // fresh (a status move can change the "New" count the nav badge reflects).
    onSuccess: (status) => {
      qc.invalidateQueries({ queryKey: ["portal-lead", ref] });
      qc.invalidateQueries({ queryKey: ["portal-leads"] });
      toast.toast(`Status → ${status}`, "success");
    },
  });

  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <Link href="/portal/leads" className="inline-flex min-h-11 items-center text-sm text-text-3 hover:text-text-2">
        ← Back to your leads
      </Link>
      <h1 className="mb-4 mt-1 font-display text-xl font-semibold tracking-tight text-text">
        Lead <span className="num">{ref}</span>
      </h1>

      {error ? (
        <EmptyState title="Couldn't load this lead" description={(error as Error).message} />
      ) : isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle as="h2">Lead details</CardTitle>
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
                <NativeSelect
                  label="Status"
                  className="min-h-11" // ≥44px touch target on the portal (F-66)
                  value={data.status}
                  disabled={update.isPending}
                  error={update.isError ? (update.error as Error).message : undefined}
                  options={data.availableStatuses.map((s) => ({ value: s, label: s }))}
                  onChange={(e) => {
                    if (e.target.value !== data.status) update.mutate(e.target.value);
                  }}
                />
                {update.isPending && (
                  <span className="mt-1.5 flex items-center gap-1.5 text-xs text-text-3" aria-live="polite">
                    <Spinner size={12} /> Saving…
                  </span>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Status history</CardTitle>
            </CardHeader>
            <CardBody>
              {data.history.length === 0 ? (
                <p className="text-sm text-text-3">No changes yet — the current status is the default.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {data.history.map((h, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <Badge>{h.status}</Badge>
                      <span className="num text-step-1 text-text-3">{new Date(h.changedAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          <NotesPanel leadRef={ref} title="Your notes" headingLevel="h2" />
        </div>
      )}
    </main>
  );
}
