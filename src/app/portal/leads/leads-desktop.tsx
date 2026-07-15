"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import {
  Button, Card, FilterPill, Table, THead, TBody, Th, Tr, Td, Pagination, DEFAULT_PAGE_SIZE, Skeleton, EmptyState,
} from "@/components";
import { statusPillClass } from "@/lib/status-pill";
// leads-contract, NOT ./queries: this is a "use client" component and a VALUE import
// from queries would pull its @/db → postgres → node:fs chain into the client bundle.
import { PORTAL_STATUS_FILTERS, type PortalLeadSort, type PartnerLeadPage } from "@/modules/portal/leads-contract";

// WP-PW-3 Task 2: the desktop (>= lg) Leads table — admin-style sortable, status-
// filterable, server-side-paginated (mirrors src/app/leads/leads-view.tsx, portal-scoped).
// Owns its own query/state entirely (no shared state with LeadsMobile) — exactly one of
// the two mounts after the media query settles. Note: on a desktop first paint,
// useIsDesktop() is false until that first render resolves, so LeadsMobile briefly
// mounts (and fetches) before page.tsx swaps to this component.

const DEFAULT_DIR: Record<PortalLeadSort, "asc" | "desc"> = {
  received: "desc",
  status: "asc",
  city: "asc",
  state: "asc",
  ref: "asc",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function LeadsDesktop() {
  const [sort, setSort] = React.useState<PortalLeadSort>("received");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
  const [statuses, setStatuses] = React.useState<string[]>([]);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);

  // Admin compare pattern (leads-view.tsx): a derived key that resets `page` to 1 the
  // moment sort/dir/statuses/pageSize change — a render-time compare, NOT an effect.
  const filterKey = `${sort}|${dir}|${statuses.join(",")}|${pageSize}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  if (filterKey !== resetKey) {
    setResetKey(filterKey);
    setPage(1);
  }

  const onSort = (field: PortalLeadSort) => {
    if (sort === field) setDir((p) => (p === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setDir(DEFAULT_DIR[field]);
    }
  };

  const toggleStatus = (s: string) => setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const leadsQ = useQuery({
    queryKey: ["portal-leads-desktop", filterKey, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ sort, dir, page: String(page), pageSize: String(pageSize) });
      if (statuses.length) params.set("status", statuses.join(","));
      return apiGet<PartnerLeadPage>(`/api/portal/leads?${params.toString()}`);
    },
  });

  const data = leadsQ.data;
  const sortDir = (f: PortalLeadSort) => (sort === f ? dir : null);

  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      {/* T7a: admin list-page order — filters row (pills left, in-body action right),
          live result count, then the table in a Card (the admin leads-view idiom). */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* D3: the shared FilterPill primitive (the second former copy of the recipe). */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-text-3">Status</span>
          <FilterPill active={statuses.length === 0} onClick={() => setStatuses([])}>
            All
          </FilterPill>
          {PORTAL_STATUS_FILTERS.map((s) => (
            <FilterPill key={s} active={statuses.includes(s)} onClick={() => toggleStatus(s)}>
              {s}
            </FilterPill>
          ))}
        </div>
        <a href="/api/portal/leads/export" download>
          <Button variant="secondary" size="lg">
            Export
          </Button>
        </a>
      </div>

      {/* Live result count (admin T2 copy) — re-announces as the filter narrows the set.
          Suppressed at zero and on error (D2): the EmptyState announces those settles —
          stale `data` can coexist with `error` on a failed background refetch. */}
      {data && data.total > 0 && !leadsQ.error && (
        <p className="mb-2 text-step-1 text-text-3" aria-live="polite">
          <span className="num font-semibold text-text-2">{data.total.toLocaleString()}</span>{" "}
          {data.total === 1 ? "lead" : "leads"}{statuses.length ? " match the filters" : ""}
        </p>
      )}

      <Card>
        {leadsQ.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : leadsQ.error ? (
          // EmptyState itself announces (role="status" on the primitive since D2, SC 4.1.3).
          <div className="p-6">
            <EmptyState title="Couldn't load your leads" description={(leadsQ.error as Error).message} />
          </div>
        ) : data!.leads.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No leads found"
              description={statuses.length ? "Try widening the status filter." : "Leads assigned to you will appear here after the next upload."}
            />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th sortable sortDir={sortDir("ref")} onSort={() => onSort("ref")}>Ref</Th>
                <Th>Seller</Th>
                <Th>Address</Th>
                <Th sortable sortDir={sortDir("city")} onSort={() => onSort("city")}>City</Th>
                <Th sortable sortDir={sortDir("state")} onSort={() => onSort("state")}>State</Th>
                <Th sortable sortDir={sortDir("received")} onSort={() => onSort("received")} align="right">Received</Th>
                <Th sortable sortDir={sortDir("status")} onSort={() => onSort("status")}>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {data!.leads.map((l) => (
                <Tr key={l.refId} className="hover:bg-surface-2">
                  <Td>
                    <Link
                      href={`/portal/leads/${l.refId}`}
                      className="num rounded font-medium text-brand-ink outline-none hover:underline focus-visible:ring-1 focus-visible:ring-brand-ink"
                    >
                      {l.refId}
                    </Link>
                  </Td>
                  <Td><span className="text-sm text-text">{l.sellerFirst} {l.sellerLast}</span></Td>
                  <Td>
                    <span className="text-sm text-text-2">{l.address}</span>
                    <span className="ml-1.5 text-xs text-text-3">{[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span></span>
                  </Td>
                  <Td><span className="text-sm text-text-2">{l.city}</span></Td>
                  <Td><span className="num text-sm text-text-2">{l.state}</span></Td>
                  <Td align="right"><span className="num text-xs text-text-3 tabular-nums">{fmtDate(l.receivedAt)}</span></Td>
                  <Td><span className={statusPillClass(l.status)}>{l.status}</span></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {data && data.total > 0 && (
        <Pagination
          className="mt-4"
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </main>
  );
}
