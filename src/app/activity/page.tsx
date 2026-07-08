"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { TopBar } from "../runs/_shell";
import { Card, Table, THead, TBody, Th, Tr, Td, Badge, Button, EmptyState, Skeleton } from "@/components";

// ACT-01/04: the tenant's audit trail, newest first, with security events highlighted.
interface Item {
  id: string;
  when: string;
  actor: string | null;
  action: string;
  entityType: string;
  entityRef: string | null;
  category: "security" | "data";
}
interface Page { items: Item[]; page: number; pageSize: number; total: number }

export default function ActivityPage() {
  const [page, setPage] = React.useState(1);
  const [securityOnly, setSecurityOnly] = React.useState(false);
  const { data, isPending, error } = useQuery({
    queryKey: ["activity", page],
    queryFn: () => apiGet<Page>(`/api/activity?page=${page}`),
  });

  const rows = (data?.items ?? []).filter((i) => !securityOnly || i.category === "security");
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="min-h-full">
      <TopBar active="activity" />
      <main className="mx-auto max-w-[1000px] px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Activity</h1>
            <p className="mt-1 text-sm text-text-2">Everything that changed — who did what, and when.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-2">
            <input type="checkbox" checked={securityOnly} onChange={(e) => setSecurityOnly(e.target.checked)} className="h-4 w-4 accent-brand" />
            Security only
          </label>
        </div>

        <Card>
          {isPending ? (
            <div className="flex flex-col gap-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : error ? (
            <div className="p-6"><EmptyState title="Couldn't load activity" description={(error as Error).message} /></div>
          ) : rows.length === 0 ? (
            <div className="p-6"><EmptyState title="Nothing here yet" description={securityOnly ? "No security events on this page." : "Actions will appear here as you use the app."} /></div>
          ) : (
            <Table>
              <THead>
                <Tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Item</Th><Th>Type</Th></Tr>
              </THead>
              <TBody>
                {rows.map((i) => (
                  <Tr key={i.id}>
                    <Td><span className="num text-xs text-text-3">{new Date(i.when).toLocaleString()}</span></Td>
                    <Td><span className="text-sm text-text-2">{i.actor ?? "system"}</span></Td>
                    <Td><span className="num text-xs text-text-2">{i.action}</span></Td>
                    <Td><span className="num text-xs text-text-3">{i.entityRef ?? "—"}</span></Td>
                    <Td><Badge variant={i.category === "security" ? "warn" : "neutral"}>{i.category}</Badge></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {data && data.total > data.pageSize && (
          <div className="mt-4 flex items-center justify-between text-sm text-text-3">
            <span className="num">Page {data.page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
