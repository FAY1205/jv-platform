"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  AppShell, Card, Badge, Button, Dialog, Select, Input, EmptyState, Skeleton,
  useToast, Table, THead, TBody, Th, Tr, Td, Pagination,
  RowOpenButton, DEFAULT_PAGE_SIZE, usePageHeader, Tooltip,
} from "@/components";
import type { StateCoverage } from "@/modules/coverage/map";
import { US_STATES } from "@/lib/us-states";
import { googleSearchUrl } from "@/lib/search-links";
import { formatWaiting } from "@/lib/waiting";

// ASN-03: the unmatched inbox. A clear "how big is the backlog" header whose state
// chips FILTER the table (T3, owner note #4), the real county choropleth (same map
// family as the dashboard — the hex cartogram is gone), and a searchable, sortable,
// server-paginated leads table (reuses /api/leads?partnerId=unmatched — no unbounded
// fetch, F-11). Each lead can be handed to a partner (additive, PRN-05); the row
// opens the shared LeadDialog (F-55).

const LeadDialog = dynamic(() => import("../leads/lead-dialog").then((m) => m.LeadDialog), { ssr: false });
// The county choropleth carries ~0.9 MB of geometry — code-split + client-only so the
// header and table paint immediately (same treatment as the dashboard hero map).
const CountyCoverageMap = dynamic(() => import("@/components/CountyCoverageMap").then((m) => m.CountyCoverageMap), {
  ssr: false,
  loading: () => <Skeleton className="aspect-[960/600] w-full rounded-xl" />,
});

interface Partner { id: string; refId: string; name: string; color: string }
interface StateStats { total: number; byState: { state: string; count: number }[] }
interface LeadRow {
  refId: string; seller: string; address: string; city: string | null; state: string | null;
  zip: string | null; campaign: string | null; receivedAt: string;
}
interface LeadsPage { leads: LeadRow[]; page: number; pageSize: number; total: number }

const PARTNER_PLACEHOLDER = "__choose__";
type UnmatchedSort = "received" | "seller";
const DEFAULT_DIR: Record<UnmatchedSort, "asc" | "desc"> = { received: "desc", seller: "asc" };

// Heat ramp for the gap map: theme-aware amber tokens (PRN-12), light (few) → dark (many).
// The exact count still shows on hover + in the chips + the legend, so magnitude is never
// conveyed by color alone (PRN-14).
const HEAT_RAMP = ["var(--brand-line)", "var(--brand)", "var(--brand-strong)", "var(--brand-ink)"] as const;
function heatFill(count: number, max: number): string {
  if (max <= 0) return HEAT_RAMP[0];
  const t = count / max;
  return t > 0.75 ? HEAT_RAMP[3] : t > 0.5 ? HEAT_RAMP[2] : t > 0.25 ? HEAT_RAMP[1] : HEAT_RAMP[0];
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-4 shadow-sm">
      <div className="text-step-1 text-text-3">{label}</div>
      <div className={"num mt-0.5 font-display text-2xl font-semibold leading-tight " + (accent ? "text-warn" : "text-text")}>{value}</div>
    </div>
  );
}

function HeatLegend() {
  return (
    <div className="flex items-center gap-2 text-step-0 text-text-3" aria-hidden="true">
      <span>Fewer</span>
      <span className="flex overflow-hidden rounded-full border border-border-soft">
        {HEAT_RAMP.map((c) => <span key={c} className="h-3 w-5" style={{ background: c }} />)}
      </span>
      <span>More</span>
    </div>
  );
}

function AssignModal({ refId, onClose }: { refId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roster = useQuery({ queryKey: ["partners"], queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners") });
  const [partnerId, setPartnerId] = React.useState(PARTNER_PLACEHOLDER);

  const assign = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/leads/${refId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ partnerId }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Assign failed.");
      return b as { message?: string };
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["unmatched"] });
      qc.invalidateQueries({ queryKey: ["unmatched-stats"] });
      qc.invalidateQueries({ queryKey: ["coverage"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.toast(b.message ?? "Lead assigned.", "success");
      onClose();
    },
    onError: (e: Error) => toast.toast(e.message, "danger"),
  });

  const chosen = partnerId !== PARTNER_PLACEHOLDER;
  return (
    <Dialog
      open
      onClose={onClose}
      title={<span className="num">Assign {refId}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => assign.mutate()} loading={assign.isPending} disabled={!chosen}>Assign lead</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Partner"
          value={partnerId}
          onValueChange={setPartnerId}
          options={[
            { value: PARTNER_PLACEHOLDER, label: "Choose a partner…" },
            ...(roster.data?.partners ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` })),
          ]}
        />
        <p className="text-step-1 text-text-3">Recorded in the activity log. The lead&apos;s original &ldquo;unmatched&rdquo; record is kept — history isn&apos;t rewritten.</p>
      </div>
    </Dialog>
  );
}

function UnmatchedInner() {
  return (
    <AppShell>
      <UnmatchedBody />
    </AppShell>
  );
}

function UnmatchedBody() {
  usePageHeader({ title: "Unmatched" });
  // Snapshot "now" at mount (waiting times are a snapshot, not a live ticker) — keeps
  // Date.now() out of the render body (react-hooks/purity).
  const [now] = React.useState(() => Date.now());
  const statsQ = useQuery({ queryKey: ["unmatched-stats"], queryFn: () => apiGet<StateStats>("/api/leads/unmatched") });
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  const [assigningRef, setAssigningRef] = React.useState<string | null>(null);
  const [openRef, setOpenRef] = React.useState<string | null>(null);

  // T3 filters/sort — state comes from the header chips; q is a debounced search.
  const [stateFilter, setStateFilter] = React.useState("");
  const [qInput, setQInput] = React.useState("");
  const [qCommitted, setQCommitted] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setQCommitted(qInput.trim()), 300); return () => clearTimeout(t); }, [qInput]);
  const [sort, setSort] = React.useState<UnmatchedSort>("received");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");

  // Admin filterKey pattern: a render-time compare resets `page` when any filter changes.
  const filterKey = `${stateFilter}|${qCommitted}|${sort}|${dir}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  if (filterKey !== resetKey) { setResetKey(filterKey); setPage(1); }

  const onSort = (field: UnmatchedSort) => {
    if (sort === field) setDir((p) => (p === "asc" ? "desc" : "asc"));
    else { setSort(field); setDir(DEFAULT_DIR[field]); }
  };
  const sortDir = (f: UnmatchedSort) => (sort === f ? dir : null);

  const listQ = useQuery({
    queryKey: ["unmatched", "list", filterKey, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ partnerId: "unmatched", sort, dir, page: String(page), pageSize: String(pageSize) });
      if (stateFilter) params.set("state", stateFilter);
      if (qCommitted) params.set("q", qCommitted);
      return apiGet<LeadsPage>(`/api/leads?${params.toString()}`);
    },
  });

  const stats = statsQ.data;
  const gapStates = React.useMemo(() => (stats?.byState ?? []).filter((g) => g.state !== "—"), [stats]);
  const noStateCount = React.useMemo(() => stats?.byState.find((g) => g.state === "—")?.count ?? 0, [stats]);
  const maxCount = React.useMemo(() => gapStates.reduce((m, g) => Math.max(m, g.count), 0), [gapStates]);
  // The gap choropleth: states WITH unmatched leads are shaded by volume (light → dark amber,
  // the hover names the exact count); everything else is calm neutral land — an uncolored
  // state here means "no unmatched leads", not "uncovered" (that's the Coverage page's story).
  const gapMapStates: StateCoverage[] = React.useMemo(() => {
    const byCode = new Map(gapStates.map((g) => [g.state, g.count]));
    return US_STATES.map((s) => {
      const count = byCode.get(s.code);
      return count
        ? { code: s.code, name: s.name, partnerId: "gap", partnerName: `${count} unmatched lead${count === 1 ? "" : "s"}`, refId: null, color: heatFill(count, maxCount), leadCount: count, gap: true }
        : { code: s.code, name: s.name, partnerId: null, partnerName: null, refId: null, color: null, leadCount: 0, gap: false };
    });
  }, [gapStates, maxCount]);

  const hasFilters = Boolean(stateFilter || qCommitted);
  const chip = (active: boolean) =>
    active
      ? "inline-flex items-center gap-1.5 rounded-full border border-warn bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn"
      : "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-2 transition-colors hover:border-warn hover:text-warn";

  return (
    <>
      {statsQ.isPending ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : statsQ.error ? (
        <Card><div className="p-6"><EmptyState title="Couldn't load unmatched leads" description={(statsQ.error as Error).message} /></div></Card>
      ) : (stats?.total ?? 0) === 0 ? (
        <Card><div className="p-8"><EmptyState title="Nothing unmatched — full coverage" description="Every lead you've processed reached a partner. New gaps will show up here." /></div></Card>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Stats: the size of the backlog at a glance (T3 / owner note #3). */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Unmatched leads" value={stats!.total.toLocaleString()} accent />
            <StatTile label={`State${gapStates.length === 1 ? "" : "s"} with gaps`} value={gapStates.length.toLocaleString()} />
            <StatTile label="Largest gap" value={gapStates[0] ? `${gapStates[0].state} · ${gapStates[0].count}` : "—"} />
          </div>
          {noStateCount > 0 && (
            <p className="-mt-2 text-step-1 text-text-3">
              <span className="num font-semibold text-text-2">{noStateCount}</span> lead{noStateCount === 1 ? "" : "s"} have no state on the record — find them by searching below.
            </p>
          )}

          {/* Searchable, sortable, paginated table — promoted above the map: this is where
              the work happens; the map is context (owner note #3). Reuses the leads list (F-11). */}
          <div>
            <div className="mb-3 flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="w-full max-w-[300px]">
                  <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search seller, address, ZIP, lead ID…" aria-label="Search unmatched leads" />
                </div>
                {/* Suppressed at zero and on error (D2): the EmptyState announces those settles —
                    stale `data` can coexist with `error` on a failed background refetch. */}
                {listQ.data && listQ.data.total > 0 && !listQ.error && (
                  <p className="text-step-1 text-text-3" aria-live="polite">
                    <span className="num font-semibold text-text-2">{listQ.data.total.toLocaleString()}</span>{" "}
                    {listQ.data.total === 1 ? "lead" : "leads"}{hasFilters ? " match the filters" : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter the table by state">
                <button type="button" onClick={() => setStateFilter("")} aria-pressed={stateFilter === ""} className={chip(stateFilter === "")}>
                  All states
                </button>
                {gapStates.map((g) => (
                  <button
                    key={g.state}
                    type="button"
                    onClick={() => setStateFilter((prev) => (prev === g.state ? "" : g.state))}
                    aria-pressed={stateFilter === g.state}
                    className={chip(stateFilter === g.state)}
                  >
                    <span className="num">{g.state}</span>
                    <span className="num font-semibold">{g.count}</span>
                  </button>
                ))}
              </div>
            </div>
            <Card>
              {listQ.isPending ? (
                <div className="flex flex-col gap-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
              ) : listQ.error ? (
                <div className="p-6"><EmptyState title="Couldn't load the list" description={(listQ.error as Error).message} /></div>
              ) : listQ.data!.leads.length === 0 ? (
                <div className="p-6"><EmptyState title="No leads found" description="Try widening the state filter or clearing the search." /></div>
              ) : (
                <Table>
                  <THead>
                    <Tr>
                      <Th>Lead</Th>
                      <Th sortable sortDir={sortDir("seller")} onSort={() => onSort("seller")}>Seller</Th>
                      <Th>Property</Th><Th>Source</Th>
                      <Th sortable sortDir={sortDir("received")} onSort={() => onSort("received")} align="right">Waiting</Th>
                      <Th align="right">Assign</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {listQ.data!.leads.map((l) => (
                      <Tr key={l.refId} className="hover:bg-surface-2">
                        <Td><RowOpenButton className="text-xs" onClick={() => setOpenRef(l.refId)}>{l.refId}</RowOpenButton></Td>
                        <Td><span className="text-sm text-text">{l.seller}</span></Td>
                        <Td>
                          <Tooltip content="Search this property on Google">
                            <a href={googleSearchUrl([l.address, l.city, l.state, l.zip])} target="_blank" rel="noopener noreferrer" className="group inline-flex items-baseline gap-1 hover:underline">
                              <span className="text-sm text-text-2 group-hover:text-brand-ink">{l.address}</span>
                              <span className="text-xs text-text-3">{[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span></span>
                            </a>
                          </Tooltip>
                        </Td>
                        <Td>{l.campaign ? <Badge variant="neutral">{l.campaign}</Badge> : <span className="text-xs text-text-3">—</span>}</Td>
                        <Td align="right"><Tooltip content={new Date(l.receivedAt).toLocaleString()}><span className="num tabular-nums text-text-2" tabIndex={0}>{formatWaiting(l.receivedAt, now)}</span></Tooltip></Td>
                        <Td align="right"><Button size="sm" variant="primary" onClick={() => setAssigningRef(l.refId)}>Assign →</Button></Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
            {listQ.data && listQ.data.total > 0 && (
              <Pagination className="mt-4" page={listQ.data.page} pageSize={listQ.data.pageSize} total={listQ.data.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
            )}
          </div>

          {/* The gap heat map — context below the table. States shade by unmatched volume. */}
          <section className="rounded-2xl border border-border-soft bg-surface p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-step-3 font-semibold tracking-tight">Where the gaps are</h2>
              <HeatLegend />
            </div>
            <CountyCoverageMap
              states={gapMapStates}
              neutralUncovered
              ariaLabel="United States map shading states by their number of unmatched leads"
              uncoveredHoverLabel={(name) => `No unmatched leads in ${name}`}
              caption={{ title: "Coverage gaps", subtitle: `${stats!.total} lead${stats!.total === 1 ? "" : "s"} · ${gapStates.length} state${gapStates.length === 1 ? "" : "s"}` }}
            />
            <p className="mt-3 text-step-1 text-text-3">Darker states have more unmatched leads. Recruiting a partner (or adding coverage) there closes the gap.</p>
          </section>
        </div>
      )}

      {assigningRef && <AssignModal refId={assigningRef} onClose={() => setAssigningRef(null)} />}
      {openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </>
  );
}

export default function UnmatchedPage() {
  return <UnmatchedInner />;
}
