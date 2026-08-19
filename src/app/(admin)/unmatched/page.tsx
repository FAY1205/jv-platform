"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { apiGet } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  AppShell, Card, Badge, Button, Checkbox, Dialog, Select, Input, EmptyState, ClearFiltersButton, QueryErrorState, Skeleton,
  useToast, Table, THead, TBody, Th, Tr, Td, Pagination, PartnerTag,
  RowOpenButton, DEFAULT_PAGE_SIZE, usePageHeader, Tooltip,
} from "@/components";
import type { StateCoverage } from "@/modules/coverage/map";
import { US_STATES } from "@/lib/us-states";
import { googleSearchUrl } from "@/lib/search-links";
import { formatWaiting, waitingTone } from "@/lib/waiting";
import { LABEL_SEPARATOR } from "@/lib/geo/us-state-anchors";

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
interface CoverageMatch { partnerId: string; refId: string; name: string; color: string; count: number }
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

/** MAP-07 (WP-UX-4): the ramp anchored to the REAL data range. The numbers come from the
 *  served stats the map fills and the chips already use (PRN-15) — nothing is re-derived —
 *  and they anchor the DATA range, not `heatFill`'s quartile bucket edges: the honest read is
 *  "lightest ≈ {min}, darkest ≈ {max}". Because it now carries values it stops being
 *  `aria-hidden` decoration and becomes a role="img" with a range sentence (PRN-14). */
function HeatLegend({ min, max }: { min: number; max: number }) {
  const plural = (n: number) => (n === 1 ? "" : "s");
  const single = min === max;
  const label = single
    ? `Every state with gaps has ${min} unmatched lead${plural(min)}`
    : `Shading ranges from ${min} unmatched lead${plural(min)} (lightest) to ${max} (darkest) per state`;
  return (
    <div className="flex items-center gap-2 text-step-0 text-text-3" role="img" aria-label={label}>
      {single ? (
        <>
          <span className="h-3 w-5 rounded-full border border-border-soft" style={{ background: HEAT_RAMP[3] }} />
          <span><span className="num font-semibold text-text-2">{min}</span> per state</span>
        </>
      ) : (
        <>
          <span>Fewer</span>
          <span className="num font-semibold text-text-2">{min}</span>
          <span className="flex overflow-hidden rounded-full border border-border-soft">
            {HEAT_RAMP.map((c) => <span key={c} className="h-3 w-5" style={{ background: c }} />)}
          </span>
          <span className="num font-semibold text-text-2">{max}</span>
          <span>More</span>
        </>
      )}
    </div>
  );
}

/** Invalidate everything an assignment changes (list, stats, backfill, downstream views). */
function invalidateAfterAssign(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["unmatched"] });
  qc.invalidateQueries({ queryKey: ["unmatched-stats"] });
  qc.invalidateQueries({ queryKey: ["unmatched-backfill"] });
  qc.invalidateQueries({ queryKey: ["coverage"] });
  qc.invalidateQueries({ queryKey: ["leads"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
}

/** One modal for both flows: a single row's "Assign →" passes one ref, the bulk
 *  bar passes the selection. Both post to the transactional bulk endpoint. */
function AssignModal({ refIds, onClose, onAssigned }: { refIds: string[]; onClose: () => void; onAssigned?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roster = useQuery({ queryKey: ["partners"], queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners") });
  const [partnerId, setPartnerId] = React.useState(PARTNER_PLACEHOLDER);

  const assign = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/leads/assign-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ leadRefs: refIds, partnerId }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Assign failed.");
      return b as { message?: string };
    },
    onSuccess: (b) => {
      invalidateAfterAssign(qc);
      toast.toast(b.message ?? "Leads assigned.", "success");
      onAssigned?.();
      onClose();
    },
    onError: (e: Error) => toast.toast(e.message, "danger"),
  });

  const chosen = partnerId !== PARTNER_PLACEHOLDER;
  const many = refIds.length > 1;
  return (
    <Dialog
      open
      onClose={onClose}
      title={many ? <span>Assign <span className="num">{refIds.length}</span> leads</span> : <span className="num">Assign {refIds[0]}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => assign.mutate()} loading={assign.isPending} disabled={!chosen}>
            {many ? `Assign ${refIds.length} leads` : "Assign lead"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Partner"
          required
          value={partnerId}
          onValueChange={setPartnerId}
          options={[
            { value: PARTNER_PLACEHOLDER, label: "Choose a partner…" },
            ...(roster.data?.partners ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` })),
          ]}
        />
        <p className="text-step-1 text-text-3">Recorded in the activity log. Each lead&apos;s original &ldquo;unmatched&rdquo; record is kept — history isn&apos;t rewritten.</p>
      </div>
    </Dialog>
  );
}

/** Owner note #2: after coverage changes, offer to hand matching unmatched leads to
 *  the covering partner in one click. Renders nothing when coverage matches nothing. */
function CoverageBackfillCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const matchesQ = useQuery({
    queryKey: ["unmatched-backfill"],
    queryFn: () => apiGet<{ matches: CoverageMatch[] }>("/api/leads/unmatched/backfill"),
  });

  const backfill = useMutation({
    mutationFn: async (partnerId: string) => {
      const res = await fetch("/api/leads/unmatched/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ partnerId }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Assign failed.");
      return b as { message?: string };
    },
    onSuccess: (b) => {
      invalidateAfterAssign(qc);
      toast.toast(b.message ?? "Leads assigned.", "success");
    },
    onError: (e: Error) => toast.toast(e.message, "danger"),
  });

  // R-8: a failed fetch must NOT read as "nothing to backfill" (both would render null and
  // could mask a real coverage-matching bug) — surface it with a Retry instead.
  if (matchesQ.error) {
    return (
      <div className="rounded-2xl border border-border-soft bg-surface p-4">
        <QueryErrorState
          compact
          title="Couldn't check for coverage backfills."
          error={matchesQ.error}
          onRetry={() => matchesQ.refetch()}
        />
      </div>
    );
  }
  const matches = matchesQ.data?.matches ?? [];
  if (matches.length === 0) return null;
  return (
    <div className="rounded-2xl border border-warn bg-warn-soft p-4">
      <p className="text-sm font-semibold text-text">Coverage now matches some of these leads</p>
      <p className="mt-0.5 text-step-1 text-text-2">Partner coverage added after these leads arrived can take them now — assigning goes straight to the partner.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {matches.map((m) => (
          <li key={m.partnerId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <PartnerTag size="sm" name={m.name} color={m.color} refId={m.refId} />
              <span className="text-step-1 text-text-2">
                covers <span className="num font-semibold">{m.count}</span> unmatched lead{m.count === 1 ? "" : "s"}
              </span>
            </span>
            <Button
              size="sm"
              variant="primary"
              loading={backfill.isPending && backfill.variables === m.partnerId}
              disabled={backfill.isPending}
              onClick={() => backfill.mutate(m.partnerId)}
            >
              Assign {m.count} to {m.refId}
            </Button>
          </li>
        ))}
      </ul>
    </div>
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
  const [assigning, setAssigning] = React.useState<string[] | null>(null);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [openRef, setOpenRef] = React.useState<string | null>(null);

  // T3 filters/sort — state comes from the header chips; q is a debounced search.
  const [stateFilter, setStateFilter] = React.useState("");
  const [qInput, setQInput] = React.useState("");
  const qCommitted = useDebouncedValue(qInput.trim());
  const [sort, setSort] = React.useState<UnmatchedSort>("received");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");

  // Admin filterKey pattern: a render-time compare resets `page` (and the bulk
  // selection — hidden selected rows would be a surprise) when any filter changes.
  const filterKey = `${stateFilter}|${qCommitted}|${sort}|${dir}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  if (filterKey !== resetKey) { setResetKey(filterKey); setPage(1); setSelected(new Set()); }

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
  const minCount = React.useMemo(() => (gapStates.length ? gapStates.reduce((m, g) => Math.min(m, g.count), Infinity) : 0), [gapStates]);
  // MAP-06: one on-map chip per gap state, formatted HERE from the stats the page already
  // holds — the map derives nothing (PRN-15). "—" (no state on the record) has no geography
  // and is already filtered out of `gapStates`, so it is never labeled.
  const stateLabels = React.useMemo(
    () => gapStates.map((g) => ({ code: g.state, text: `${g.state}${LABEL_SEPARATOR}${g.count}` })),
    [gapStates],
  );
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

  // Bulk selection (S6): row checkboxes + a header select-all for the current page.
  // The selection survives paging (assign across pages) and clears on filter change.
  const pageRefs = React.useMemo(() => (listQ.data?.leads ?? []).map((l) => l.refId), [listQ.data]);
  const allPageSelected = pageRefs.length > 0 && pageRefs.every((r) => selected.has(r));
  const toggleRef = (refId: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(refId);
      else next.delete(refId);
      return next;
    });
  const togglePage = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pageRefs) {
        if (on) next.add(r);
        else next.delete(r);
      }
      return next;
    });
  const chip = (active: boolean) =>
    active
      ? "inline-flex items-center gap-1.5 rounded-full border border-warn bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn"
      : "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-2 transition-colors hover:border-warn hover:text-warn";

  return (
    <>
      {statsQ.isPending ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : statsQ.error ? (
        <Card><div className="p-6"><QueryErrorState title="Couldn't load unmatched leads" error={statsQ.error} onRetry={() => statsQ.refetch()} /></div></Card>
      ) : (stats?.total ?? 0) === 0 ? (
        <Card><div className="p-8"><EmptyState title="Nothing unmatched — full coverage" description="Every lead you've processed reached a partner. New gaps will show up here." /></div></Card>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Coverage backfill offer (owner note #2) — only when coverage matches something. */}
          <CoverageBackfillCard />

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
            {selected.size > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn bg-warn-soft px-3 py-2">
                <span className="text-sm font-semibold text-text">
                  <span className="num">{selected.size}</span> lead{selected.size === 1 ? "" : "s"} selected
                </span>
                <span className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                  <Button size="sm" variant="primary" onClick={() => setAssigning([...selected])}>
                    Assign selected →
                  </Button>
                </span>
              </div>
            )}
            <Card>
              {listQ.isPending ? (
                <div className="flex flex-col gap-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
              ) : listQ.error ? (
                <div className="p-6"><QueryErrorState title="Couldn't load the list" error={listQ.error} onRetry={() => listQ.refetch()} /></div>
              ) : listQ.data!.leads.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No leads found"
                    description="Try widening the state filter or clearing the search."
                    // C-54: `hasFilters` is the page's existing derivation (state chip OR the
                    // committed search); the action clears BOTH, which is the whole filter set.
                    action={hasFilters ? <ClearFiltersButton onClick={() => { setStateFilter(""); setQInput(""); }} /> : undefined}
                  />
                </div>
              ) : (
                // C-53: seven columns, and Waiting + Assign — the two the page exists for —
                // are the ones that fall off a narrow card today. 640px keeps the decision
                // columns on screen and makes the clipping honest with the edge fade.
                <Table className="min-w-[640px]" ariaLabel="Unmatched leads" scrollHint>
                  <THead>
                    <Tr>
                      <Th><Checkbox checked={allPageSelected} onCheckedChange={togglePage} ariaLabel="Select all leads on this page" /></Th>
                      <Th>Lead</Th>
                      <Th sortable sortDir={sortDir("seller")} onSort={() => onSort("seller")}>Seller</Th>
                      <Th>Property</Th><Th>Source</Th>
                      <Th sortable sortDir={sortDir("received")} onSort={() => onSort("received")} align="right">Waiting</Th>
                      <Th align="right">Assign</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {listQ.data!.leads.map((l) => (
                      <Tr key={l.refId} className="group hover:bg-surface-2">
                        <Td><Checkbox checked={selected.has(l.refId)} onCheckedChange={(v) => toggleRef(l.refId, v)} ariaLabel={`Select ${l.refId}`} /></Td>
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
                        <Td align="right">
                          <Tooltip content={fmtDateTime(l.receivedAt)}>
                            {(() => {
                              const tone = waitingTone(l.receivedAt, now);
                              return (
                                <span
                                  className={`num tabular-nums ${tone === "danger" ? "font-semibold text-danger" : tone === "warn" ? "font-semibold text-warn" : "text-text-2"}`}
                                  tabIndex={0}
                                >
                                  {formatWaiting(l.receivedAt, now)}
                                </span>
                              );
                            })()}
                          </Tooltip>
                        </Td>
                        {/* WP-UX-6 (audit U-1): row Assign demoted to secondary and filled only on
                            row hover/focus, so the bulk "Assign selected" is the page's one primary
                            and 20 rows stop shouting. */}
                        <Td align="right">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="transition-colors group-hover:border-brand group-hover:bg-brand group-hover:text-brand-contrast"
                            onClick={() => setAssigning([l.refId])}
                          >
                            Assign →
                          </Button>
                        </Td>
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
              {gapStates.length > 0 && <HeatLegend min={minCount} max={maxCount} />}
            </div>
            <CountyCoverageMap
              states={gapMapStates}
              stateLabels={stateLabels}
              neutralUncovered
              ariaLabel="United States map shading states by their number of unmatched leads; each shaded state is labeled with its code and count"
              uncoveredHoverLabel={(name) => `No unmatched leads in ${name}`}
              caption={{ title: "Coverage gaps", subtitle: `${stats!.total} lead${stats!.total === 1 ? "" : "s"} · ${gapStates.length} state${gapStates.length === 1 ? "" : "s"}` }}
            />
            <p className="mt-3 text-step-1 text-text-3">Darker states have more unmatched leads. Recruiting a partner (or adding coverage) there closes the gap.</p>
          </section>
        </div>
      )}

      {assigning && <AssignModal refIds={assigning} onClose={() => setAssigning(null)} onAssigned={() => setSelected(new Set())} />}
      {openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </>
  );
}

export default function UnmatchedPage() {
  return <UnmatchedInner />;
}
