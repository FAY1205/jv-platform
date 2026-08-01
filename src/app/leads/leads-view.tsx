"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { apiGet } from "@/lib/api";
import { LEAD_STATUS_FILTERS, type LeadSortField } from "@/modules/leads/schema";
import {
  AppShell, Card, Table, THead, TBody, Th, Tr, Td, PartnerTag, EmptyState, Skeleton,
  Input, Select, Combobox, DateRangePicker, Pagination, RowOpenButton, StatusSelect,
  DEFAULT_PAGE_SIZE, usePageHeader, FilterPill, Tooltip,
} from "@/components";
import { US_STATES } from "@/lib/us-states";
import { googleSearchUrl } from "@/lib/search-links";

const LeadDialog = dynamic(() => import("./lead-dialog").then((m) => m.LeadDialog), { ssr: false });

// ADM: the global leads list. The filter bar is isolated from the table so search
// keystrokes don't reconcile the body (F-54); rows open via a keyboard button (F-14);
// status is a pill Select; pagination has rows-per-page (FEP-03). Server-side
// filtered/sorted/paged; the LeadDialog is code-split (F-56).

interface LeadRow {
  refId: string; seller: string; address: string; city: string | null; state: string | null;
  zip: string | null; campaign: string | null; mlsStatus: "kept" | "removed"; status: string;
  partner: { id: string; name: string; refId: string; color: string } | null;
  receivedAt: string; modifiedAt: string | null;
}
interface LeadsPage { leads: LeadRow[]; page: number; pageSize: number; total: number }
interface Partner { id: string; refId: string; name: string; color: string }

export interface Filters {
  q: string; partnerId: string; state: string; source: string; statuses: string[]; dateFrom: string; dateTo: string;
}
const EMPTY: Filters = { q: "", partnerId: "", state: "", source: "", statuses: [], dateFrom: "", dateTo: "" };

const DEFAULT_DIR: Record<LeadSortField, "asc" | "desc"> = { received: "desc", modified: "desc", status: "desc", partner: "asc", seller: "asc" };
const PARTNER_ALL = "__all__";
const PARTNER_UNMATCHED = "unmatched";
const SOURCE_ALL = "__all__";

export function LeadsView({ initialQ }: { initialQ: string }) {
  return (
    <AppShell>
      <LeadsBody initialQ={initialQ} />
    </AppShell>
  );
}

// Rendered inside AppShell's PageHeaderProvider so usePageHeader resolves — the "Leads"
// title lives in the topbar (WP-E shell pattern), so no in-body <h1>.
function LeadsBody({ initialQ }: { initialQ: string }) {
  usePageHeader({ title: "Leads" });

  const [filters, setFilters] = React.useState<Filters>({ ...EMPTY, q: initialQ });
  const [sort, setSort] = React.useState<LeadSortField>("received");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  const [openRef, setOpenRef] = React.useState<string | null>(null);

  const filterKey = `${filters.q}|${filters.partnerId}|${filters.state}|${filters.source}|${filters.statuses.join(",")}|${filters.dateFrom}|${filters.dateTo}|${sort}|${dir}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  if (filterKey !== resetKey) { setResetKey(filterKey); setPage(1); }

  const onSort = (field: LeadSortField) => {
    if (sort === field) setDir((p) => (p === "asc" ? "desc" : "asc"));
    else { setSort(field); setDir(DEFAULT_DIR[field]); }
  };

  return (
    <>
      <LeadsFilterBar seedQ={initialQ} onChange={setFilters} />

      <LeadsTable
        filterKey={filterKey}
        filters={filters}
        sort={sort}
        dir={dir}
        page={page}
        pageSize={pageSize}
        onSort={onSort}
        onOpen={setOpenRef}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />

      {openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </>
  );
}

// ── Filter bar (isolated; owns raw text + debounce, lifts committed filters) ──
const LeadsFilterBar = React.memo(function LeadsFilterBar({ seedQ, onChange }: { seedQ: string; onChange: (f: Filters) => void }) {
  const [qInput, setQInput] = React.useState(seedQ);
  // State filter — a searchable full-name Combobox (owner note #2); selection commits
  // the 2-letter code directly (no debounce — picking is an explicit act).
  const [state, setState] = React.useState("");
  const [partnerId, setPartnerId] = React.useState(PARTNER_ALL);
  const [source, setSource] = React.useState("");
  const [statuses, setStatuses] = React.useState<string[]>([]);
  const [range, setRange] = React.useState<{ from: string | null; to: string | null }>({ from: null, to: null });

  // Committed (debounced) search text, held as state so "Clear all" can reset it
  // synchronously — otherwise the trailing debounce would re-commit stale search text
  // after an immediate clear, briefly showing a wrong result set.
  const [qCommitted, setQCommitted] = React.useState(seedQ.trim());
  React.useEffect(() => { const t = setTimeout(() => setQCommitted(qInput.trim()), 300); return () => clearTimeout(t); }, [qInput]);

  // Re-seed the search box ONLY when the topbar pushes a new ?q= — never from our own
  // upstream commits (which would clobber in-progress typing).
  const [seeded, setSeeded] = React.useState(seedQ);
  if (seedQ !== seeded) { setSeeded(seedQ); setQInput(seedQ); setQCommitted(seedQ.trim()); }

  const roster = useQuery({ queryKey: ["partners"], queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners") });
  const sourcesQ = useQuery({ queryKey: ["lead-sources"], queryFn: () => apiGet<{ sources: string[] }>("/api/leads/sources") });

  const clearAll = () => {
    setQInput(""); setQCommitted("");
    setState("");
    setPartnerId(PARTNER_ALL); setSource(""); setStatuses([]); setRange({ from: null, to: null });
  };

  // Commit filters upward whenever a committed value changes. On "Clear all" the committed
  // text is reset in the same batch, so this fires once with a fully-empty, correct set.
  React.useEffect(() => {
    onChange({ q: qCommitted, state, partnerId: partnerId === PARTNER_ALL ? "" : partnerId, source, statuses, dateFrom: range.from ?? "", dateTo: range.to ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qCommitted, state, partnerId, source, statuses.join(","), range.from, range.to]);

  const toggleStatus = (s: string) => setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  const hasFilters = Boolean(qInput || state || partnerId !== PARTNER_ALL || source || statuses.length || range.from);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2.5">
        <div className="w-full max-w-[300px]">
          <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search seller, address, ZIP, lead ID…" aria-label="Search leads" />
        </div>
        <div className="w-48">
          <Select
            ariaLabel="Filter by partner"
            value={partnerId}
            onValueChange={setPartnerId}
            options={[
              { value: PARTNER_ALL, label: "All partners" },
              { value: PARTNER_UNMATCHED, label: "Unmatched only" },
              ...(roster.data?.partners ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` })),
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            ariaLabel="Filter by source"
            value={source || SOURCE_ALL}
            onValueChange={(v) => setSource(v === SOURCE_ALL ? "" : v)}
            options={[{ value: SOURCE_ALL, label: "All sources" }, ...(sourcesQ.data?.sources ?? []).map((s) => ({ value: s, label: s }))]}
          />
        </div>
        <div className="w-48">
          <Combobox
            ariaLabel="Filter by state"
            placeholder="All states"
            value={state}
            onValueChange={setState}
            options={US_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))}
          />
        </div>
        <div className="w-52">
          <DateRangePicker value={range} onChange={setRange} placeholder="Received range" />
        </div>
        {hasFilters && (
          <button type="button" onClick={clearAll} className="text-xs text-text-3 underline-offset-2 hover:text-text hover:underline">
            Clear all
          </button>
        )}
      </div>

      {/* D3: the shared FilterPill primitive (was a hand-rolled recipe duplicated in the
          portal leads table — FRONTEND_STANDARDS §2 promotion rule). */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-text-3">Status</span>
        {LEAD_STATUS_FILTERS.map((s) => (
          <FilterPill key={s} active={statuses.includes(s)} onClick={() => toggleStatus(s)}>
            {s}
          </FilterPill>
        ))}
      </div>
    </>
  );
});

// ── Table (consumes only committed state → no keystroke reconciliation) ──
function LeadsTable({
  filterKey, filters, sort, dir, page, pageSize, onSort, onOpen, onPageChange, onPageSizeChange,
}: {
  filterKey: string; filters: Filters; sort: LeadSortField; dir: "asc" | "desc"; page: number; pageSize: number;
  onSort: (f: LeadSortField) => void; onOpen: (ref: string) => void; onPageChange: (p: number) => void; onPageSizeChange: (n: number) => void;
}) {
  const leadsQ = useQuery({
    queryKey: ["leads", filterKey, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ q: filters.q, sort, dir, page: String(page), pageSize: String(pageSize) });
      if (filters.partnerId) params.set("partnerId", filters.partnerId);
      if (filters.state) params.set("state", filters.state);
      if (filters.source) params.set("source", filters.source);
      if (filters.statuses.length) params.set("statuses", filters.statuses.join(","));
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);
      return apiGet<LeadsPage>(`/api/leads?${params.toString()}`);
    },
  });
  const data = leadsQ.data;
  const hasFilters = Boolean(filters.q || filters.partnerId || filters.state || filters.source || filters.statuses.length || filters.dateFrom);
  const sortDir = (f: LeadSortField) => (sort === f ? dir : null);

  return (
    <>
      {/* Live result count (owner note #2) — re-announces as filters narrow the set.
          Suppressed at zero and on error (D2): the EmptyState below announces those
          settles; a "0 leads" line would double-announce, and a failed background
          refetch keeps stale `data` while the error branch renders. */}
      {data && data.total > 0 && !leadsQ.error && (
        <p className="mb-2 text-step-1 text-text-3" aria-live="polite">
          <span className="num font-semibold text-text-2">{data.total.toLocaleString()}</span>{" "}
          {data.total === 1 ? "lead" : "leads"}{hasFilters ? " match the filters" : ""}
        </p>
      )}
      <Card>
        {leadsQ.isPending ? (
          <div className="flex flex-col gap-3 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : leadsQ.error ? (
          <div className="p-6"><EmptyState title="Couldn't load leads" description={(leadsQ.error as Error).message} /></div>
        ) : data!.leads.length === 0 ? (
          <div className="p-6"><EmptyState title="No leads found" description={hasFilters ? "Try widening the filters." : "Process a weekly file to see leads here."} /></div>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Lead</Th>
                <Th sortable sortDir={sortDir("seller")} onSort={() => onSort("seller")}>Seller</Th>
                <Th>Property</Th>
                <Th sortable sortDir={sortDir("partner")} onSort={() => onSort("partner")}>Partner</Th>
                <Th sortable sortDir={sortDir("received")} onSort={() => onSort("received")} align="right">Received</Th>
                <Th sortable sortDir={sortDir("modified")} onSort={() => onSort("modified")} align="right">Modified</Th>
                <Th sortable sortDir={sortDir("status")} onSort={() => onSort("status")}>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {data!.leads.map((l) => (
                <Tr key={l.refId} className="hover:bg-surface-2">
                  <Td><RowOpenButton className="text-xs" onClick={() => onOpen(l.refId)}>{l.refId}</RowOpenButton></Td>
                  <Td><span className="text-sm text-text">{l.seller}</span></Td>
                  <Td>
                    <Tooltip content="Search this property on Google">
                      <a href={googleSearchUrl([l.address, l.city, l.state, l.zip])} target="_blank" rel="noopener noreferrer" className="group inline-flex items-baseline gap-1 hover:underline">
                        <span className="text-sm text-text-2 group-hover:text-brand-ink">{l.address}</span>
                        <span className="text-xs text-text-3">{[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span></span>
                      </a>
                    </Tooltip>
                  </Td>
                  <Td>
                    {l.partner ? <PartnerTag size="sm" name={l.partner.name} color={l.partner.color} refId={l.partner.refId} />
                      : l.mlsStatus === "kept" ? <span className="text-xs font-semibold text-warn">Unmatched</span>
                      : <span className="text-xs text-text-3">—</span>}
                  </Td>
                  <Td align="right"><span className="num text-xs text-text-3 tabular-nums">{new Date(l.receivedAt).toLocaleDateString()}</span></Td>
                  <Td align="right"><span className="num text-xs text-text-3 tabular-nums">{l.modifiedAt ? new Date(l.modifiedAt).toLocaleDateString() : "—"}</span></Td>
                  <Td><StatusSelect refId={l.refId} status={l.status} mlsStatus={l.mlsStatus} /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {data && data.total > 0 && (
        <Pagination className="mt-4" page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
      )}
    </>
  );
}
