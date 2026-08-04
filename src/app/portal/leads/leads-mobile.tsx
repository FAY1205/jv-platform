"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Button, EmptyState, Skeleton, HotLeadMark } from "@/components";
import { statusPillClass } from "@/lib/status-pill";

// WP-PW-3 Task 2: the mobile (< lg) Leads view, extracted verbatim from the pre-WP-PW-3
// page.tsx (same markup/classes/behavior, same page-only query) so mobile stays pixel-
// and behavior-identical — only the gate in page.tsx changed, not this component.

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
  scoreTotal: number | null;
  scoreGroup: "hot" | "warm" | "nurture" | null;
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

export function LeadsMobile({ onOpen }: { onOpen: (refId: string) => void }) {
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
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-text md:hidden">Your leads</h1>
          {total > 0 && <p className="text-step-1 text-text-3">{total} total</p>}
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
              <button
                key={l.refId}
                type="button"
                onClick={() => onOpen(l.refId)}
                className="block w-full rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition-[background-color,border-color,transform] hover:border-text-3 hover:bg-surface-2 focus-visible:border-brand-ink focus-visible:outline-none active:scale-[.99]"
              >
                <div className="flex items-center gap-2">
                  <span className="num text-step-1 text-text-3">{l.refId}</span>
                  {l.scoreGroup === "hot" && l.scoreTotal !== null && <HotLeadMark score={l.scoreTotal} />}
                  <span className={statusPillClass(l.status, "ml-auto")}>
                    {l.status}
                  </span>
                </div>
                <div className="mt-1.5 text-base font-semibold text-text">{l.address}</div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-step-1 text-text-2">
                  <span>
                    {l.city}, {l.state}
                  </span>
                  <span className="num text-text-3">{l.zip}</span>
                  <span className="text-text-3">· {fmtDate(l.receivedAt)}</span>
                </div>
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-step-1 text-text-3">
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
