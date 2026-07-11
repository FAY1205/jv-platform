"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Button, EmptyState, Skeleton, STATUS_PILL } from "@/components";
import { cn } from "@/lib/cn";

interface Lead {
  refId: string;
  sellerFirst: string;
  sellerLast: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  receivedAt: string;
  status: string;
  previouslyMatched: boolean;
}
interface LeadsPage {
  leads: Lead[];
  page: number;
  pageSize: number;
  total: number;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export default function PortalLeadsPage() {
  const [page, setPage] = React.useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-leads", page],
    queryFn: () => apiGet<LeadsPage>(`/api/portal/leads?page=${page}`),
  });

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto w-full flex-1 p-4">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-text">Your leads</h1>
          {total > 0 && <p className="text-[13px] text-text-3">{total} total</p>}
        </div>
        <a href="/api/portal/leads/export" download>
          <Button variant="secondary" size="lg">
            Export
          </Button>
        </a>
      </div>

      {error ? (
        <EmptyState title="Couldn't load your leads" description={(error as Error).message} />
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : leads.length === 0 ? (
        <EmptyState title="No leads yet" description="Leads assigned to you will appear here after the next upload." />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {leads.map((l) => (
              <Link
                key={l.refId}
                href={`/portal/leads/${l.refId}`}
                className="block rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-text-3 hover:bg-surface-2 focus-visible:border-brand-ink"
              >
                <div className="flex items-center gap-2">
                  <span className="num text-[13px] text-text-3">{l.refId}</span>
                  <span className={cn("num ml-auto inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_PILL[l.status] ?? "bg-surface-3 text-text-2")}>
                    {l.status}
                  </span>
                </div>
                <div className="mt-1.5 text-base font-semibold text-text">{l.address}</div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[13px] text-text-2">
                  <span>
                    {l.city}, {l.state}
                  </span>
                  <span className="num text-text-3">{l.zip}</span>
                  <span className="text-text-3">· {fmtDate(l.receivedAt)}</span>
                  {l.previouslyMatched && <span className="text-text-3">· returning</span>}
                </div>
              </Link>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-text-3">
              <span>
                Page <span className="num">{page}</span> of <span className="num">{totalPages}</span> · <span className="num">{total}</span> leads
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="lg" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
