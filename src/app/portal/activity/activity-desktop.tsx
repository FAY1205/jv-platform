"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Card, Table, THead, TBody, Th, Tr, Td, Badge, EmptyState, Skeleton, Button } from "@/components";

// WP-PW-4 Task 1: the desktop (>= lg) Activity table (mirrors src/app/activity/page.tsx's
// admin table idiom, portal-scoped). Owns its own query entirely — same query key as
// ActivityMobile (they never mount together; a returning user reuses the cache).
// No in-body <h1> — the desktop top bar already shows "Your activity" (WP-PW-1's
// portalTitleForPath). The endpoint has no sort (plain Th, not sortable) and no
// `total` (prev/next pager, not the Pagination primitive) — matches ActivityMobile's
// pager exactly.

// ACT-02: the partner's own actions on their own leads (status updates + notes).
interface Item { when: string; kind: "status" | "note"; detail: string }
interface Page { items: Item[]; page: number; pageSize: number }

export function ActivityDesktop() {
  const [page, setPage] = React.useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-activity", page],
    queryFn: () => apiGet<Page>(`/api/portal/activity?page=${page}`),
  });
  const items = data?.items ?? [];

  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <Card>
        {error ? (
          <div className="p-6"><EmptyState title="Couldn't load activity" description={(error as Error).message} /></div>
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
                  <Td align="right"><span className="num text-step-1 text-text-3">{new Date(i.when).toLocaleString()}</span></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {(page > 1 || items.length === (data?.pageSize ?? 50)) && (
        <div className="mt-4 flex justify-between">
          <Button variant="secondary" size="lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="lg" disabled={items.length < (data?.pageSize ?? 50)} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </main>
  );
}
