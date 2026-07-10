"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { AppShell, Card, Table, THead, TBody, Th, Tr, Td, Badge, Input, Select, DateRangePicker, Pagination, EmptyState, Skeleton } from "@/components";
import type { DateRangeValue } from "@/components/DateRangePicker";

// ACT-01/04: the tenant's audit trail, server-side filtered (category, actor, date range,
// search) + sorted + paginated. Security events are badged (categorize.ts single source).
interface Item {
  id: string;
  when: string;
  actor: string | null;
  action: string;
  entityType: string;
  entityRef: string | null;
  category: "security" | "data";
}
interface Resp {
  items: Item[];
  page: number;
  pageSize: number;
  total: number;
  actors: { id: string; email: string }[];
}

const ACTOR_ALL = "__all__"; // Radix Select forbids an empty value

export default function ActivityPage() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [category, setCategory] = React.useState("all");
  const [actor, setActor] = React.useState("");
  const [range, setRange] = React.useState<DateRangeValue>({ from: null, to: null });
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
  const [q, setQ] = React.useState("");
  const [qDebounced, setQDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const reset = () => setPage(1); // any filter change returns to page 1

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), category, dir });
  if (actor) params.set("actor", actor);
  if (qDebounced) params.set("q", qDebounced);
  if (range.from) params.set("dateFrom", range.from);
  if (range.to) params.set("dateTo", range.to);

  const { data, isPending, error } = useQuery({
    queryKey: ["activity", { page, pageSize, category, actor, dir, q: qDebounced, from: range.from, to: range.to }],
    queryFn: () => apiGet<Resp>(`/api/activity?${params.toString()}`),
  });

  const rows = data?.items ?? [];
  const actors = data?.actors ?? [];

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Activity</h1>
        <p className="mt-1 text-sm text-text-2">Everything that changed — who did what, and when.</p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Search" placeholder="Action or reference…" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
        <Select
          label="Category"
          value={category}
          onValueChange={(v) => { setCategory(v); reset(); }}
          options={[{ value: "all", label: "All" }, { value: "security", label: "Security" }, { value: "data", label: "Data" }]}
        />
        <Select
          label="Actor"
          value={actor || ACTOR_ALL}
          onValueChange={(v) => { setActor(v === ACTOR_ALL ? "" : v); reset(); }}
          options={[{ value: ACTOR_ALL, label: "Everyone" }, ...actors.map((a) => ({ value: a.id, label: a.email }))]}
        />
        <DateRangePicker label="Date range" value={range} onChange={(v) => { setRange(v); reset(); }} />
      </div>

      <Card>
        {isPending ? (
          <div className="flex flex-col gap-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : error ? (
          <div className="p-6"><EmptyState title="Couldn't load activity" description={(error as Error).message} /></div>
        ) : rows.length === 0 ? (
          <div className="p-6"><EmptyState title="Nothing matches" description="Try widening the filters or clearing the search." /></div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th sortable sortDir={dir} onSort={() => { setDir((d) => (d === "asc" ? "desc" : "asc")); reset(); }}>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Item</Th>
                <Th>Type</Th>
              </Tr>
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

      {data && data.total > 0 && (
        <div className="mt-4">
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); reset(); }}
          />
        </div>
      )}
    </AppShell>
  );
}
