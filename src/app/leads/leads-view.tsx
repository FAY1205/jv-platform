"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { LEAD_STATUS_FILTERS, type LeadSortField } from "@/modules/leads/schema";
import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";
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
  NativeSelect,
  PartnerTag,
  EmptyState,
  Skeleton,
  ToastProvider,
  useToast,
} from "@/components";
import { LeadDialog } from "./lead-dialog";

// ADM: the global leads list. Columns: Lead · Seller · Property · Partner ·
// Received · Modified · Status. Status is inline-editable (kept leads); removed
// leads show a read-only verdict chip. Clicking a row opens the lead dialog (no
// navigation). Search debounced (FEP-04); filter + sort + paginate server-side.

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
  modifiedAt: string | null;
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

const STATUS_PILL: Record<string, string> = {
  New: "bg-surface-3 text-text-2",
  Contacted: "bg-brand-soft text-brand",
  Appointment: "bg-warn-soft text-warn",
  "Under contract": "bg-prev-soft text-prev",
  Closed: "bg-success-soft text-success",
  Dead: "bg-danger-soft text-danger",
};

// Default sort direction per column — dates/status newest-first, names A→Z.
const DEFAULT_DIR: Record<LeadSortField, "asc" | "desc"> = {
  received: "desc",
  modified: "desc",
  status: "desc",
  partner: "asc",
  seller: "asc",
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function googleUrl(parts: (string | null)[]): string {
  return `https://www.google.com/search?q=${encodeURIComponent(parts.filter(Boolean).join(" "))}`;
}

const fieldCls =
  "h-9 rounded-[11px] border border-border bg-surface px-3 text-sm text-text outline-none transition-colors placeholder:text-text-3 focus-visible:border-brand-line";

export function LeadsView({ initialQ }: { initialQ: string }) {
  const urlQ = initialQ;

  // Seed the search field from the URL; re-seed when the topbar pushes a new ?q=
  // (adjust-state-during-render — the blessed seeding pattern, ADR-0008).
  const [qInput, setQInput] = React.useState(urlQ);
  const [seededFrom, setSeededFrom] = React.useState(urlQ);
  if (urlQ !== seededFrom) {
    setSeededFrom(urlQ);
    setQInput(urlQ);
  }

  const [partnerId, setPartnerId] = React.useState("");
  const [state, setState] = React.useState("");
  const [source, setSource] = React.useState("");
  const [statuses, setStatuses] = React.useState<string[]>([]);
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [sort, setSort] = React.useState<LeadSortField>("received");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = React.useState(1);
  const [openRef, setOpenRef] = React.useState<string | null>(null);
  const q = useDebounced(qInput.trim(), 300);

  // Any filter/sort change goes back to page 1 (same render-adjust pattern).
  const filterKey = `${q}|${partnerId}|${state}|${source}|${statuses.join(",")}|${dateFrom}|${dateTo}|${sort}|${dir}`;
  const [pageResetKey, setPageResetKey] = React.useState(filterKey);
  if (filterKey !== pageResetKey) {
    setPageResetKey(filterKey);
    setPage(1);
  }

  const roster = useQuery({
    queryKey: ["partners"],
    queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners"),
  });
  const sourcesQ = useQuery({
    queryKey: ["lead-sources"],
    queryFn: () => apiGet<{ sources: string[] }>("/api/leads/sources"),
  });
  const leadsQ = useQuery({
    queryKey: ["leads", filterKey, page],
    queryFn: () => {
      const params = new URLSearchParams({ q, partnerId, state, source, sort, dir, page: String(page) });
      if (statuses.length) params.set("statuses", statuses.join(","));
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      return apiGet<LeadsPage>(`/api/leads?${params.toString()}`);
    },
  });

  const data = leadsQ.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = Boolean(q || partnerId || state || source || statuses.length || dateFrom || dateTo);

  const onSort = (field: LeadSortField) => {
    if (sort === field) setDir((prev) => (prev === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setDir(DEFAULT_DIR[field]);
    }
  };
  const sortDir = (field: LeadSortField) => (sort === field ? dir : null);

  const toggleStatus = (s: string) =>
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <ToastProvider>
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Leads</h1>
        <p className="mt-1 text-sm text-text-2">
          Every lead you&apos;ve processed. Click any row to open it; set status inline.
        </p>
      </div>

      {/* Filters — row 1 */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search seller, address, ZIP, lead ID…"
          aria-label="Search leads"
          className={`${fieldCls} w-full max-w-[300px]`}
        />
        <NativeSelect value={partnerId} onChange={(e) => setPartnerId(e.target.value)} aria-label="Filter by partner" className="w-auto">
          <option value="">All partners</option>
          <option value="unmatched">Unmatched only</option>
          {(roster.data?.partners ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.refId})
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source" className="w-auto">
          <option value="">All sources</option>
          {(sourcesQ.data?.sources ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
        <input
          value={state}
          onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
          placeholder="State"
          aria-label="Filter by state (2 letters)"
          className={`${fieldCls} w-[72px] text-center uppercase placeholder:normal-case`}
        />
        <label className="flex items-center gap-1.5 text-xs text-text-3">
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="Received from" className={`${fieldCls} num`} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-3">
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="Received to" className={`${fieldCls} num`} />
        </label>
        {data && (
          <span className="num ml-auto text-xs text-text-3">
            {data.total} lead{data.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Filters — row 2: status chips */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-text-3">Status</span>
        {LEAD_STATUS_FILTERS.map((s) => {
          const active = statuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              aria-pressed={active}
              className={
                active
                  ? "rounded-full border border-brand bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand transition-colors"
                  : "rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-text-2 transition-colors hover:border-brand-line hover:text-text"
              }
            >
              {s}
            </button>
          );
        })}
        {statuses.length > 0 && (
          <button type="button" onClick={() => setStatuses([])} className="ml-1 text-xs text-text-3 underline-offset-2 hover:text-text hover:underline">
            Clear
          </button>
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
              description={hasFilters ? "Try widening the filters." : "Process a weekly file to see leads here."}
            />
          </div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Lead</Th>
                <Th sortable sortDir={sortDir("seller")} onSort={() => onSort("seller")}>
                  Seller
                </Th>
                <Th>Property</Th>
                <Th sortable sortDir={sortDir("partner")} onSort={() => onSort("partner")}>
                  Partner
                </Th>
                <Th sortable sortDir={sortDir("received")} onSort={() => onSort("received")} align="right">
                  Received
                </Th>
                <Th sortable sortDir={sortDir("modified")} onSort={() => onSort("modified")} align="right">
                  Modified
                </Th>
                <Th sortable sortDir={sortDir("status")} onSort={() => onSort("status")}>
                  Status
                </Th>
              </Tr>
            </THead>
            <TBody>
              {data!.leads.map((l) => (
                <Tr
                  key={l.refId}
                  className="cursor-pointer hover:bg-surface-2"
                  onClick={() => setOpenRef(l.refId)}
                >
                  <Td>
                    <span className="num text-xs font-semibold text-brand">{l.refId}</span>
                  </Td>
                  <Td>
                    <span className="text-sm text-text">{l.seller}</span>
                  </Td>
                  <Td>
                    <a
                      href={googleUrl([l.address, l.city, l.state, l.zip])}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="group inline-flex items-baseline gap-1 hover:underline"
                      title="Search this property on Google"
                    >
                      <span className="text-sm text-text-2 group-hover:text-brand">{l.address}</span>
                      <span className="text-xs text-text-3">
                        {[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span>
                      </span>
                    </a>
                  </Td>
                  <Td>
                    {l.partner ? (
                      <PartnerTag size="sm" name={l.partner.name} color={l.partner.color} refId={l.partner.refId} />
                    ) : l.mlsStatus === "kept" ? (
                      <span className="text-xs font-semibold text-warn">Unmatched</span>
                    ) : (
                      <span className="text-xs text-text-3">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="num text-xs text-text-3">{new Date(l.receivedAt).toLocaleDateString()}</span>
                  </Td>
                  <Td align="right">
                    <span className="num text-xs text-text-3">
                      {l.modifiedAt ? new Date(l.modifiedAt).toLocaleDateString() : "—"}
                    </span>
                  </Td>
                  <Td>
                    <InlineStatus lead={l} />
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

      {openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </AppShell>
    </ToastProvider>
  );
}

// Inline status control — a styled native select (accessible, keyboard-friendly).
// Removed leads are read-only (PRN-04): they show the verdict chip, not a dropdown.
function InlineStatus({ lead }: { lead: LeadRow }) {
  const qc = useQueryClient();
  const toast = useToast();

  // Optimistic local value (re-seeds when the server row changes — ADR-0008).
  const [val, setVal] = React.useState(lead.status);
  const [seeded, setSeeded] = React.useState(lead.status);
  if (lead.status !== seeded) {
    setSeeded(lead.status);
    setVal(lead.status);
  }

  const mut = useMutation({
    mutationFn: async (status: string) => {
      const res = await fetch(`/api/leads/${lead.refId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ status }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Status update failed.");
      return b as { status: string };
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["lead", lead.refId] });
      toast.toast(`Status → ${b.status}`, "success");
    },
    onError: (e: Error, _s, ctx) => {
      setVal((ctx as { prev: string })?.prev ?? lead.status);
      toast.toast(e.message, "danger");
    },
    onMutate: (status: string) => {
      const prev = val;
      setVal(status);
      return { prev };
    },
  });

  if (lead.mlsStatus === "removed") {
    return <Badge variant="removed">Removed · MLS</Badge>;
  }

  return (
    <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <select
        value={val}
        disabled={mut.isPending}
        onChange={(e) => mut.mutate(e.target.value)}
        aria-label={`Status for ${lead.refId}`}
        className={`num cursor-pointer appearance-none rounded-full px-2.5 py-0.5 text-xs font-semibold outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-brand-line disabled:opacity-60 ${
          STATUS_PILL[val] ?? "bg-surface-3 text-text-2"
        }`}
      >
        {SEED_LEAD_STATUSES.map((s) => (
          <option key={s} value={s} className="bg-surface text-text">
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
