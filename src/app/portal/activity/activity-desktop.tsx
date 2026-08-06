"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { Card, Table, THead, TBody, Th, Tr, Td, Badge, EmptyState, QueryErrorState, Skeleton, Pagination, DEFAULT_PAGE_SIZE } from "@/components";

// WP-PW-4 Task 1: the desktop (>= lg) Activity table (mirrors src/app/(admin)/activity/page.tsx's
// admin table idiom, portal-scoped). Owns its own query entirely — same query key as
// ActivityMobile (they never mount together; a returning user reuses the cache).
// No in-body <h1> — the desktop top bar already shows "Your activity" (WP-PW-1's
// portalTitleForPath). WP-PP-5: the endpoint now returns a real `total`, so this uses the
// shared Pagination primitive (rows-per-page + jump) like the admin activity table — the
// hand-rolled prev/next pager is gone.

// ACT-02: the partner's own actions on their own leads (status updates + notes).
interface Item { when: string; kind: "status" | "note"; detail: string }
interface Page { items: Item[]; page: number; pageSize: number; total: number }

export function ActivityDesktop() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portal-activity", page, pageSize],
    queryFn: () => apiGet<Page>(`/api/portal/activity?page=${page}&pageSize=${pageSize}`),
  });
  const items = data?.items ?? [];

  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <Card>
        {error ? (
          <div className="p-6"><QueryErrorState title="Couldn't load activity" error={error} onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <div className="flex flex-col gap-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : items.length === 0 ? (
          <div className="p-6"><EmptyState title="No activity yet" description="Your status updates and notes will show up here." /></div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Kind</Th>
                <Th>Detail</Th>
                <Th align="right">When</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((i, idx) => (
                <Tr key={idx}>
                  <Td><Badge variant={i.kind === "status" ? "state" : "neutral"}>{i.kind === "status" ? "Status" : "Note"}</Badge></Td>
                  <Td><span className="num text-sm text-text-2">{i.detail}</span></Td>
                  <Td align="right"><span className="num text-step-1 text-text-3">{fmtDateTime(i.when)}</span></Td>
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
    </main>
  );
}
