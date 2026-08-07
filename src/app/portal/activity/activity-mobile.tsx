"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { Card, CardBody, Badge, EmptyState, QueryErrorState, Skeleton, Pagination, DEFAULT_PAGE_SIZE } from "@/components";

// WP-PW-4 Task 1: the mobile (< lg) Activity view. WP-PP-5: shares the desktop's query
// (real `total`) and the shared Pagination primitive instead of a hand-rolled prev/next —
// both surfaces now match the admin activity table's pagination.

// ACT-02: the partner's own actions on their own leads (status updates + notes).
interface Item { when: string; kind: "status" | "note"; detail: string }
interface Page { items: Item[]; page: number; pageSize: number; total: number }

export function ActivityMobile() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portal-activity", page, pageSize],
    queryFn: () => apiGet<Page>(`/api/portal/activity?page=${page}&pageSize=${pageSize}`),
  });
  const items = data?.items ?? [];

  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text md:hidden">Your activity</h1>
      <Card>
        <CardBody>
          {error ? (
            <QueryErrorState title="Couldn't load activity" error={error} onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="flex flex-col gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          ) : items.length === 0 ? (
            <EmptyState title="No activity yet" description="Your status updates and notes will show up here." />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {items.map((i, idx) => (
                <li key={idx} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={i.kind === "status" ? "state" : "neutral"}>{i.kind === "status" ? "Status" : "Note"}</Badge>
                    <span className="num text-sm text-text-2">{i.detail}</span>
                  </div>
                  <span className="num text-step-1 text-text-3">{fmtDateTime(i.when)}</span>
                </li>
              ))}
            </ul>
          )}
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
        </CardBody>
      </Card>
    </main>
  );
}
