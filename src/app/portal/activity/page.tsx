"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, Badge, EmptyState, Skeleton, Button } from "@/components";

// ACT-02: the partner's own actions on their own leads (status updates + notes).
interface Item { when: string; kind: "status" | "note"; detail: string }
interface Page { items: Item[]; page: number; pageSize: number }

export default function PortalActivityPage() {
  const [page, setPage] = React.useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-activity", page],
    queryFn: () => apiGet<Page>(`/api/portal/activity?page=${page}`),
  });
  const items = data?.items ?? [];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <Card>
        <CardHeader><CardTitle>Your activity</CardTitle></CardHeader>
        <CardBody>
          {error ? (
            <EmptyState title="Couldn't load activity" description={(error as Error).message} />
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
                  <span className="num text-xs text-text-3">{new Date(i.when).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          {(page > 1 || items.length === (data?.pageSize ?? 50)) && (
            <div className="mt-4 flex justify-between">
              <Button variant="secondary" size="lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" size="lg" disabled={items.length < (data?.pageSize ?? 50)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
