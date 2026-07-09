"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import {
  AppShell,
  Card,
  Table,
  THead,
  TBody,
  Th,
  Tr,
  Td,
  Badge,
  Button,
  Select,
  PartnerTag,
  EmptyState,
  Skeleton,
} from "@/components";

// ADM: the global leads list — every lead the tenant has, searchable and
// filterable. Search is debounced (FEP-04); the list paginates server-side
// (FEP-03). The topbar search lands here with ?q=.
interface LeadRow {
  refId: string;
  seller: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  campaign: string | null;
  mlsStatus: "kept" | "removed";
  status: string;
  partner: { id: string; name: string; refId: string; color: string } | null;
  receivedAt: string;
}
interface LeadsPage {
  leads: LeadRow[];
  page: number;
  pageSize: number;
  total: number;
}
interface Partner {
  id: string;
  refId: string;
  name: string;
  color: string;
}

const STATUS_VARIANT: Record<string, "neutral" | "warn" | "success" | "prev" | "removed" | "zip"> = {
  New: "neutral",
  Contacted: "zip",
  Appointment: "warn",
  "Under contract": "prev",
  Closed: "success",
  Dead: "removed",
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function LeadsView({ initialQ }: { initialQ: string }) {
  const urlQ = initialQ;

  // Seed the search field from the URL; re-seed when the topbar pushes a new ?q=
  // (adjust-state-during-render — the blessed seeding pattern, ADR-0008).
  const [qInput, setQInput] = React.useState(urlQ);
  const [seededFrom, setSeededFrom] = React.useState(urlQ);
  if (urlQ !== seededFrom) {
    // Re-seed when the topbar search pushes a new ?q= (adjust-state-during-render,
    // the blessed seeding pattern — ADR-0008).
    setSeededFrom(urlQ);
    setQInput(urlQ);
  }

  const [partnerId, setPartnerId] = React.useState("");
  const [state, setState] = React.useState("");
  const [mls, setMls] = React.useState<"all" | "kept" | "removed">("all");
  const [page, setPage] = React.useState(1);
  const q = useDebounced(qInput.trim(), 300);

  // Any filter change goes back to page 1 (same render-adjust pattern).
  const filterKey = `${q}|${partnerId}|${state}|${mls}`;
  const [pageResetKey, setPageResetKey] = React.useState(filterKey);
  if (filterKey !== pageResetKey) {
    setPageResetKey(filterKey);
    setPage(1);
  }



  const roster = useQuery({
    queryKey: ["partners"],
    queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners"),
  });
  const leadsQ = useQuery({
    queryKey: ["leads", q, partnerId, state, mls, page],
    queryFn: () =>
      apiGet<LeadsPage>(
        `/api/leads?q=${encodeURIComponent(q)}&partnerId=${partnerId}&state=${state}&mls=${mls}&page=${page}`,
      ),
  });

  const data = leadsQ.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Leads</h1>
        <p className="mt-1 text-sm text-text-2">Every lead you&apos;ve processed — search by seller, address, ZIP or ID.</p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search seller, address, ZIP, lead ID…"
          aria-label="Search leads"
          className="h-9 w-full max-w-[320px] rounded-[11px] border border-border bg-surface px-3 text-sm text-text outline-none transition-colors placeholder:text-text-3 focus-visible:border-brand-line"
        />
        <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} aria-label="Filter by partner" className="w-auto">
          <option value="">All partners</option>
          {(roster.data?.partners ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.refId})
            </option>
          ))}
        </Select>
        <Select value={mls} onChange={(e) => setMls(e.target.value as typeof mls)} aria-label="Filter by MLS outcome" className="w-auto">
          <option value="all">Kept + removed</option>
          <option value="kept">Kept only</option>
          <option value="removed">Removed only</option>
        </Select>
        <input
          value={state}
          onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
          placeholder="State"
          aria-label="Filter by state (2 letters)"
          className="h-9 w-[72px] rounded-[11px] border border-border bg-surface px-3 text-center text-sm uppercase text-text outline-none transition-colors placeholder:normal-case placeholder:text-text-3 focus-visible:border-brand-line"
        />
        {data && (
          <span className="num ml-auto text-xs text-text-3">
            {data.total} lead{data.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <Card>
        {leadsQ.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : leadsQ.error ? (
          <div className="p-6">
            <EmptyState title="Couldn't load leads" description={(leadsQ.error as Error).message} />
          </div>
        ) : data!.leads.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No leads found"
              description={q || partnerId || state || mls !== "all" ? "Try widening the filters." : "Process a weekly file to see leads here."}
            />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Lead</Th>
                <Th>Seller</Th>
                <Th>Property</Th>
                <Th>Status</Th>
                <Th>Partner</Th>
                <Th align="right">Received</Th>
              </Tr>
            </THead>
            <TBody>
              {data!.leads.map((l) => (
                <Tr key={l.refId} className="hover:bg-surface-2">
                  <Td>
                    <Link href={`/leads/${l.refId}`} className="num text-xs font-semibold text-brand hover:underline">
                      {l.refId}
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-sm text-text">{l.seller}</span>
                  </Td>
                  <Td>
                    <span className="text-sm text-text-2">{l.address}</span>
                    <span className="ml-1.5 text-xs text-text-3">
                      {[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span>
                    </span>
                  </Td>
                  <Td>
                    {l.mlsStatus === "removed" ? (
                      <Badge variant="removed">Removed · MLS</Badge>
                    ) : (
                      <Badge variant={STATUS_VARIANT[l.status] ?? "neutral"} dot>
                        {l.status}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    {l.partner ? (
                      <PartnerTag size="sm" name={l.partner.name} color={l.partner.color} refId={l.partner.refId} />
                    ) : l.mlsStatus === "kept" ? (
                      <span className="text-xs font-medium text-warn">Unmatched</span>
                    ) : (
                      <span className="text-xs text-text-3">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="num text-xs text-text-3">{new Date(l.receivedAt).toLocaleDateString()}</span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {data && data.total > data.pageSize && (
        <div className="mt-4 flex items-center justify-between text-sm text-text-3">
          <span className="num">
            Page {data.page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

