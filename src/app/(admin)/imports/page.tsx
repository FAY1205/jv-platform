"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { RunListPage } from "@/modules/run/queries";
import {
  Card, Table, THead, TBody, Th, Tr, Td, Badge, EmptyState, QueryErrorState, Skeleton, AppShell,
  DateRangePicker, type DateRangeValue, Pagination, DEFAULT_PAGE_SIZE, usePageHeader,
} from "@/components";
import { fmtDate } from "@/lib/dates";

// The Imports list ("run" stays the internal engine term; the owner-facing word
// is "import" — one processed weekly file). T4 (owner note #5): server-paginated
// (FEP-03 — a year of daily imports is 365 rows), processed-date filter, a live
// result count, and the "New import" action in-body (topbar keeps the title only).
export default function ImportsIndexPage() {
  return (
    <AppShell>
      <ImportsBody />
    </AppShell>
  );
}

function ImportsBody() {
  usePageHeader({ title: "Imports" });

  const [range, setRange] = React.useState<DateRangeValue>({ from: null, to: null });
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);

  // Admin filterKey pattern: a render-time compare resets `page` when the filter changes.
  const filterKey = `${range.from ?? ""}|${range.to ?? ""}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  if (filterKey !== resetKey) { setResetKey(filterKey); setPage(1); }

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["runs", filterKey, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (range.from) params.set("dateFrom", range.from);
      if (range.to) params.set("dateTo", range.to);
      return apiGet<RunListPage>(`/api/runs?${params.toString()}`);
    },
  });
  const hasFilter = Boolean(range.from || range.to);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2.5">
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="w-52">
            <DateRangePicker value={range} onChange={setRange} placeholder="Processed range" />
          </div>
          {/* Suppressed at zero and on error (D2): the EmptyState announces those settles —
              and a failed background refetch keeps stale `data` while `error` is set, so
              without !error the stale count and the error state would announce together. */}
          {data && data.total > 0 && !error && (
            <p className="pb-2 text-step-1 text-text-3" aria-live="polite">
              <span className="num font-semibold text-text-2">{data.total.toLocaleString()}</span>{" "}
              {data.total === 1 ? "import" : "imports"}{hasFilter ? " in this range" : ""}
            </p>
          )}
        </div>
        <Link
          href="/upload"
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-brand px-3.5 py-2 text-sm font-semibold text-brand-contrast shadow-xs transition-colors hover:bg-brand-strong active:scale-[.98]"
        >
          <span aria-hidden="true" className="text-base leading-none">+</span> New import
        </Link>
      </div>

      <Card>
        {isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6">
            <QueryErrorState title="Couldn't load imports" error={error} onRetry={() => refetch()} />
          </div>
        ) : data.runs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={hasFilter ? "No imports in this range" : "No imports yet"}
              description={hasFilter ? "Try widening the processed-date range." : "Process a weekly file to see it here."}
            />
          </div>
        ) : (
          <Table>
            {/* WP-UX-1: FILE is the one flexible column (ellipsizing, full name on hover);
                id/rows/status/date take content width — no more stranded midsection band. */}
            <THead>
              <Tr>
                <Th fit>Import</Th>
                <Th>File</Th>
                <Th fit align="right">Rows</Th>
                <Th fit>Status</Th>
                <Th fit align="right">Processed</Th>
              </Tr>
            </THead>
            <TBody>
              {data.runs.map((run) => (
                <Tr key={run.refId} className="hover:bg-surface-2">
                  <Td fit>
                    <Link href={`/imports/${run.refId}`} className="num font-semibold text-brand-ink hover:underline">
                      {run.refId}
                    </Link>
                  </Td>
                  <Td clamp clampTitle={run.filename} className="text-text-2">{run.filename}</Td>
                  <Td fit align="right"><span className="num text-text-2">{run.rowCount ?? "—"}</span></Td>
                  <Td fit>
                    <Badge variant={run.status === "processed" ? "success" : run.status === "voided" ? "removed" : "neutral"}>
                      {run.status}
                    </Badge>
                  </Td>
                  <Td fit align="right"><span className="num text-text-3">{fmtDate(run.createdAt)}</span></Td>
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
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        />
      )}
    </>
  );
}
