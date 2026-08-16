"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { fmtDate } from "@/lib/dates";
import { LEAD_STATUS_FILTERS, DEFAULT_STATUS_FILTERS, isDefaultStatuses, type LeadSortField } from "@/modules/leads/schema";
import {
  AppShell, Card, Table, THead, TBody, Th, Tr, Td, PartnerTag, EmptyState, QueryErrorState, Skeleton,
  Input, Combobox, DateRangePicker, Pagination, RowOpenButton, StatusSelect, SegmentedControl,
  DEFAULT_PAGE_SIZE, usePageHeader, FilterPill, Tooltip, HotLeadIcon,
  LeadTags, TagChip, TagPicker, SavedViewsMenu, type LeadTagView,
} from "@/components";
import type { SavedViewFilters } from "@/modules/saved-views/schema";
import { US_STATES } from "@/lib/us-states";
import { googleSearchUrl } from "@/lib/search-links";
import { setPreferences, usePreferences, type LeadsViewPref } from "@/lib/preferences";
import { useTags, useLeadTagMutations } from "@/lib/tags-client";

const LeadDialog = dynamic(() => import("./lead-dialog").then((m) => m.LeadDialog), { ssr: false });
// KAN-01: the board is a second view of the SAME page — code-split like the dialog so
// list-only sessions never pay for it.
const LeadsBoard = dynamic(() => import("./leads-board").then((m) => m.LeadsBoard), { ssr: false });

// ADM: the global leads list. The filter bar is isolated from the table so search
// keystrokes don't reconcile the body (F-54); rows open via a keyboard button (F-14);
// status is a pill Select; pagination has rows-per-page (FEP-03). Server-side
// filtered/sorted/paged; the LeadDialog is code-split (F-56).

interface LeadRow {
  refId: string; seller: string; address: string; city: string | null; state: string | null;
  zip: string | null; campaign: string | null; mlsStatus: "kept" | "removed"; status: string;
  scoreTotal: number | null; scoreGroup: "hot" | "warm" | "nurture" | null;
  partner: { id: string; name: string; refId: string; color: string } | null;
  receivedAt: string; modifiedAt: string | null;
  /** TAG-04: the row's chips, ordered by lower(name) server-side. */
  tags: LeadTagView[];
}
interface LeadsPage { leads: LeadRow[]; page: number; pageSize: number; total: number }
interface Partner { id: string; refId: string; name: string; color: string }

/**
 * The committed filter state. Defined as the saved-view blob MINUS the view mode (which is a
 * preference, not a filter), so the two can never drift: SV-01 says a view captures "the exact
 * filter-state shape the leads page serializes", and this is that sentence in the type system —
 * a new filter added to the blob fails to compile here until it is wired, and vice versa.
 * Fields: q · partnerId · state · source · statuses · hot · tags (TAG-03, OR/any-of) ·
 * dateFrom · dateTo.
 */
export type Filters = Omit<SavedViewFilters, "viewMode">;
// Opens with all workflow statuses selected but Removed MLS off (owner decision).
const EMPTY: Filters = { q: "", partnerId: "", state: "", source: "", statuses: [...DEFAULT_STATUS_FILTERS], hot: false, dateFrom: "", dateTo: "", tags: [] };

/** SV-04: a view application, carried to the filter bar. The nonce (not the object) is what
 *  marks "this is a NEW application", so re-applying the SAME view still resets the bar. */
interface AppliedView {
  n: number;
  filters: SavedViewFilters;
}

const DEFAULT_DIR: Record<LeadSortField, "asc" | "desc"> = { lead: "desc", received: "desc", modified: "desc", seller: "asc" };
// "" = no partner filter (all). The pipeline treats the "unmatched" sentinel specially.
const PARTNER_UNMATCHED = "unmatched";

export function LeadsView({ initialQ, initialOpenRef = null, initialHot = false }: { initialQ: string; initialOpenRef?: string | null; initialHot?: boolean }) {
  return (
    <AppShell>
      <LeadsBody initialQ={initialQ} initialOpenRef={initialOpenRef} initialHot={initialHot} />
    </AppShell>
  );
}

// Rendered inside AppShell's PageHeaderProvider so usePageHeader resolves — the "Leads"
// title lives in the topbar (WP-E shell pattern), so no in-body <h1>.
function LeadsBody({ initialQ, initialOpenRef = null, initialHot = false }: { initialQ: string; initialOpenRef?: string | null; initialHot?: boolean }) {
  usePageHeader({ title: "Leads" });

  const [filters, setFilters] = React.useState<Filters>({ ...EMPTY, q: initialQ, hot: initialHot });
  const [sort, setSort] = React.useState<LeadSortField>("received");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  // Seed the open dialog from ?open=<ref> (P-1 deep link); user opens/closes take over after.
  const [openRef, setOpenRef] = React.useState<string | null>(initialOpenRef);
  // SRCH-02: the deep link can also arrive while this page is ALREADY mounted — the global
  // search overlay pushes /leads?open=<ref> from /leads itself, which re-renders this view
  // with a new prop instead of remounting it. Re-seed on a CHANGE of the prop only (the
  // `resetKey` idiom above), so closing the dialog isn't immediately undone.
  const [seededOpenRef, setSeededOpenRef] = React.useState(initialOpenRef);
  if (seededOpenRef !== initialOpenRef) {
    setSeededOpenRef(initialOpenRef);
    setOpenRef(initialOpenRef);
  }

  const router = useRouter();
  // Closing drops ?open= from the URL (other params kept). Two reasons: the address bar
  // stops advertising a dialog that isn't there, and — because the re-seed above keys on a
  // CHANGE — searching for the SAME lead again is then a real null→ref transition instead
  // of a silent no-op (pr-reviewer F-1). `replace`, not `push`: closing a dialog should not
  // add a history entry.
  const closeDialog = React.useCallback(() => {
    setOpenRef(null);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("open")) return;
    url.searchParams.delete("open");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [router]);

  const filterKey = `${filters.q}|${filters.partnerId}|${filters.state}|${filters.source}|${filters.statuses.join(",")}|${filters.hot}|${filters.tags.join(",")}|${filters.dateFrom}|${filters.dateTo}|${sort}|${dir}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  if (filterKey !== resetKey) { setResetKey(filterKey); setPage(1); }

  const onSort = (field: LeadSortField) => {
    if (sort === field) setDir((p) => (p === "asc" ? "desc" : "asc"));
    else { setSort(field); setDir(DEFAULT_DIR[field]); }
  };

  // KAN-01: List/Board lives in the ONE small UI-preferences store (§6.17) — a view
  // choice is a preference, not server data, and it survives a reload and other tabs.
  const view = usePreferences().leadsView;

  // SV-01: what a saved view captures — the committed filters PLUS the mode. Memoized so the
  // menu's divergence comparison isn't handed a fresh object on every unrelated render.
  const currentView = React.useMemo<SavedViewFilters>(() => ({ ...filters, viewMode: view }), [filters, view]);

  // SV-04: applying REPLACES the whole state. The mode goes to the preferences store (it is a
  // preference wherever it came from) and the filters are pushed down to the bar, which owns
  // the uncommitted inputs — the bar re-seeds itself from this and commits back up, so there
  // is still exactly ONE path by which `filters` changes.
  const [applied, setApplied] = React.useState<AppliedView | null>(null);
  const applyView = React.useCallback((f: SavedViewFilters) => {
    setPreferences({ leadsView: f.viewMode });
    setApplied((prev) => ({ n: (prev?.n ?? 0) + 1, filters: f }));
  }, []);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        {/* SV-03 (mockup screen 1): the views dropdown sits at the head of the page. The mockup
            draws it beside the "Leads" title, which in this app lives in the SHELL topbar
            (WP-E), so it takes the leading edge of the page's own first row instead.
            usePageHeader DOES have an `actions` slot that would accept it (pr-review F-3) — the
            reason it isn't used is that NO page passes `actions` today, so this would be the
            first, and the slot has an identity contract a first user must establish: the header
            effect depends on the node, so a fresh element per render re-registers on its own
            update. A stateful control there needs a memoized node. Worth doing when a second
            page wants topbar actions; not on this WP's budget. */}
        <SavedViewsMenu filters={currentView} onApply={applyView} />
        <SegmentedControl<LeadsViewPref>
          ariaLabel="Leads view"
          value={view}
          onValueChange={(v) => setPreferences({ leadsView: v })}
          options={[{ value: "list", label: "List" }, { value: "board", label: "Board" }]}
        />
      </div>

      <LeadsFilterBar seedQ={initialQ} seedHot={initialHot} view={view} applied={applied} onChange={setFilters} />

      {view === "board" ? (
        // KAN-09 + TAG-03: the board carries the partner, hot AND tag filters (the filter bar
        // hides the rest in board mode, so nothing on screen is silently ignored).
        <LeadsBoard filters={{ partnerId: filters.partnerId, hot: filters.hot, tags: filters.tags }} onOpen={setOpenRef} />
      ) : (
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
      )}

      {openRef && <LeadDialog refId={openRef} onClose={closeDialog} />}
    </>
  );
}

// ── Filter bar (isolated; owns raw text + debounce, lifts committed filters) ──
const LeadsFilterBar = React.memo(function LeadsFilterBar({ seedQ, seedHot = false, view = "list", applied = null, onChange }: { seedQ: string; seedHot?: boolean; view?: LeadsViewPref; applied?: AppliedView | null; onChange: (f: Filters) => void }) {
  // KAN-09: the board honours the partner + hot filters. The rest (search, source,
  // state, received range, status) are list-only for v1, so board mode HIDES them
  // rather than showing controls that quietly do nothing. Their state is kept, so
  // switching back to the list restores exactly what was set.
  const listOnly = view === "list";
  const [qInput, setQInput] = React.useState(seedQ);
  // Partner / Source / State are ALL searchable Comboboxes (owner: make them match) — one
  // control shape, "" = the "All …" placeholder, selection commits directly (no debounce).
  const [state, setState] = React.useState("");
  const [partnerId, setPartnerId] = React.useState("");
  const [source, setSource] = React.useState("");
  const [statuses, setStatuses] = React.useState<string[]>([...DEFAULT_STATUS_FILTERS]);
  const [hot, setHot] = React.useState(seedHot);
  // TAG-03: selected tag ids (any-of). Carried in BOTH modes — the board honours them too.
  const [tagIds, setTagIds] = React.useState<string[]>([]);
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

  // SV-04: applying a saved view REPLACES every control here — including the ones board mode
  // hides, so switching back to the list shows the view, not a leftover. Keyed on the NONCE
  // (the `seeded` idiom above), so re-applying the same view still resets an edited bar; the
  // committed text is set alongside the input so the trailing debounce can't re-commit the
  // pre-apply search. The commit effect below then lifts the whole set upward in one pass.
  const [appliedNonce, setAppliedNonce] = React.useState(applied?.n ?? 0);
  if (applied && applied.n !== appliedNonce) {
    setAppliedNonce(applied.n);
    const f = applied.filters;
    setQInput(f.q); setQCommitted(f.q);
    setState(f.state); setPartnerId(f.partnerId); setSource(f.source);
    setStatuses([...f.statuses]); setHot(f.hot); setTagIds([...f.tags]);
    setRange({ from: f.dateFrom || null, to: f.dateTo || null });
  }

  const roster = useQuery({ queryKey: ["partners"], queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners") });
  const sourcesQ = useQuery({ queryKey: ["lead-sources"], queryFn: () => apiGet<{ sources: string[] }>("/api/leads/sources") });
  // The tag roster is fetched ONCE per page and shared with every row's picker (§6.17: the
  // query cache is the store — the rows don't each fetch it).
  const tagsQ = useTags();
  const allTags = tagsQ.data?.tags ?? [];
  const selectedTags = tagIds.map((id) => allTags.find((t) => t.id === id)).filter((t): t is (typeof allTags)[number] => Boolean(t));
  // SV-05: a saved view can carry a tag that was deleted after it was saved. The id is still
  // uuid-shaped, so it survives the `?tags=` validator and simply matches no leads — which
  // would otherwise be an EMPTY list with an INVISIBLE filter (the chip row only knows how to
  // draw tags that still exist). Draw it as a neutral, removable chip instead: the filter is
  // never silently narrowing the page. Only once the roster has actually loaded.
  const knownTagIds = new Set(allTags.map((t) => t.id));
  const missingTagIds = tagsQ.isSuccess ? tagIds.filter((id) => !knownTagIds.has(id)) : [];

  const clearAll = () => {
    setQInput(""); setQCommitted("");
    setState("");
    setPartnerId(""); setSource(""); setStatuses([...DEFAULT_STATUS_FILTERS]); setHot(false); setTagIds([]); setRange({ from: null, to: null });
  };

  // Commit filters upward whenever a committed value changes. On "Clear all" the committed
  // text is reset in the same batch, so this fires once with the default (not empty) set.
  React.useEffect(() => {
    onChange({ q: qCommitted, state, partnerId, source, statuses, hot, tags: tagIds, dateFrom: range.from ?? "", dateTo: range.to ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qCommitted, state, partnerId, source, statuses.join(","), hot, tagIds.join(","), range.from, range.to]);

  const toggleStatus = (s: string) => setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  // "Filters active" ignores the default status selection — only a change from it counts.
  const hasFilters = Boolean(qInput || state || partnerId || source || hot || tagIds.length || !isDefaultStatuses(statuses) || range.from);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2.5">
        {listOnly && (
          <div className="w-full max-w-[300px]">
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onClear={() => { setQInput(""); setQCommitted(""); }}
              placeholder="Search seller, address, ZIP, lead ID…"
              aria-label="Search leads"
            />
          </div>
        )}
        <div className="w-48">
          <Combobox
            ariaLabel="Filter by partner"
            placeholder="All partners"
            value={partnerId}
            onValueChange={setPartnerId}
            options={[
              { value: PARTNER_UNMATCHED, label: "Unmatched only" },
              ...(roster.data?.partners ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` })),
            ]}
          />
        </div>
        {listOnly && (
          <>
            <div className="w-48">
              <Combobox
                ariaLabel="Filter by source"
                placeholder="All sources"
                value={source}
                onValueChange={setSource}
                options={(sourcesQ.data?.sources ?? []).map((s) => ({ value: s, label: s }))}
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
          </>
        )}
        {/* Clear all holds a fixed slot at the row's end (ml-auto) — no more jumping as
            filters appear/disappear; disabled until there's something to clear. */}
        <button
          type="button"
          onClick={clearAll}
          disabled={!hasFilters}
          className="ml-auto self-center text-xs underline-offset-2 transition-colors enabled:text-text-3 enabled:hover:text-text enabled:hover:underline disabled:cursor-default disabled:text-text-3/40"
        >
          Clear all
        </button>
      </div>

      {/* D3: the shared FilterPill primitive (was a hand-rolled recipe duplicated in the
          portal leads table — FRONTEND_STANDARDS §2 promotion rule). */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {/* Hot-leads quick filter (SCR) — the target mark ties it to the row icon. */}
        {/* TAG-05: Hot is presented in the same chip vocabulary as the tag filters (target
            icon, "Hot"), but it is a SMART tag — a toggle over the existing `hot` param, with
            no ✕ and no tag-manager presence, because it is derived from score_group. */}
        <FilterPill active={hot} onClick={() => setHot((v) => !v)} title="Derived from the lead's score — not an editable tag">
          <span className="inline-flex items-center gap-1"><HotLeadIcon size={12} />Hot</span>
        </FilterPill>
        {/* TAG-03: the selected tag filters, as removable chips in their own colors, plus the
            picker. Create-inline is deliberately OFF here — a filter can only select a tag
            that exists (creating one from a filter row would match zero leads). */}
        {selectedTags.map((t) => (
          <TagChip
            key={t.id}
            name={t.name}
            color={t.color}
            onRemove={() => setTagIds((prev) => prev.filter((id) => id !== t.id))}
          />
        ))}
        {missingTagIds.map((id) => (
          <TagChip
            key={id}
            name="Deleted tag"
            color="" // unknown key ⇒ the neutral chip (lib/tag-chip degrades by design)
            title="This tag no longer exists, so it matches no leads. Remove it to widen the filter."
            onRemove={() => setTagIds((prev) => prev.filter((x) => x !== id))}
          />
        ))}
        <TagPicker
          variant="chip"
          triggerLabel="Tag filter"
          placeholder="Filter by tag…"
          options={allTags}
          selectedIds={tagIds}
          onSelect={(id) => setTagIds((prev) => (prev.includes(id) ? prev : [...prev, id]))}
        />
        {/* Status is what the board's COLUMNS already express — hiding the pills there
            keeps one answer to "which statuses am I looking at". */}
        {listOnly && (
          <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <span className="mr-1 text-xs font-semibold text-text-3">Status</span>
            {LEAD_STATUS_FILTERS.map((s) => (
              <FilterPill key={s} active={statuses.includes(s)} onClick={() => toggleStatus(s)}>
                {s}
              </FilterPill>
            ))}
          </>
        )}
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
      if (filters.hot) params.set("hot", "1");
      if (filters.tags.length) params.set("tags", filters.tags.join(","));
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);
      return apiGet<LeadsPage>(`/api/leads?${params.toString()}`);
    },
  });
  const data = leadsQ.data;
  const hasFilters = Boolean(filters.q || filters.partnerId || filters.state || filters.source || filters.hot || filters.tags.length || !isDefaultStatuses(filters.statuses) || filters.dateFrom);
  const sortDir = (f: LeadSortField) => (sort === f ? dir : null);
  // The SAME cache entry the filter bar reads (TAGS_KEY) — one roster fetch for the page,
  // handed to every row's picker.
  const allTags = useTags().data?.tags ?? [];
  const { attach, detach, createAndAttach, busy } = useLeadTagMutations();

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
          <div className="p-6"><QueryErrorState title="Couldn't load leads" error={leadsQ.error} onRetry={() => leadsQ.refetch()} /></div>
        ) : data!.leads.length === 0 ? (
          <div className="p-6"><EmptyState title="No leads found" description={hasFilters ? "Try widening the filters." : "Process a weekly file to see leads here."} /></div>
        ) : (
          <Table>
            {/* WP-UX-1 width budget (audit T1): IDs/dates/status take content width
                (`fit`), Seller/Property/Partner absorb the leftover and ellipsize
                (`clamp`) — a date never wraps to two lines, a name never wraps while
                a neighbor column sits half-empty. Tags stays auto: chips wrap in place. */}
            <THead>
              <Tr>
                <Th fit sortable sortDir={sortDir("lead")} onSort={() => onSort("lead")}>Lead</Th>
                <Th sortable sortDir={sortDir("seller")} onSort={() => onSort("seller")} className="w-[14%]">Seller</Th>
                <Th className="w-[28%]">Property</Th>
                <Th className="w-[23%]">Partner</Th>
                <Th>Tags</Th>
                <Th fit sortable sortDir={sortDir("received")} onSort={() => onSort("received")} align="right">Received</Th>
                <Th fit sortable sortDir={sortDir("modified")} onSort={() => onSort("modified")} align="right">Modified</Th>
                <Th fit>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {data!.leads.map((l) => (
                <Tr key={l.refId} className="hover:bg-surface-2">
                  <Td fit>
                    <span className="inline-flex items-center gap-1.5">
                      <RowOpenButton className="text-xs" onClick={() => onOpen(l.refId)}>{l.refId}</RowOpenButton>
                    </span>
                  </Td>
                  <Td clamp clampTitle={l.seller}><span className="text-sm text-text">{l.seller}</span></Td>
                  {/* One flowing line, single wrap point (audit 4.3): street + muted
                      city/state/zip as inline runs that truncate together — the city
                      fragment no longer lands at a different x-offset per row. */}
                  <Td clamp>
                    <Tooltip content="Search this property on Google">
                      <a href={googleSearchUrl([l.address, l.city, l.state, l.zip])} target="_blank" rel="noopener noreferrer" className="group hover:underline">
                        <span className="text-sm text-text-2 group-hover:text-brand-ink">{l.address}</span>{" "}
                        <span className="text-xs text-text-3">{[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span></span>
                      </a>
                    </Tooltip>
                  </Td>
                  <Td clamp clampTitle={l.partner ? `${l.partner.name} (${l.partner.refId})` : undefined}>
                    {l.partner ? <PartnerTag size="sm" name={l.partner.name} color={l.partner.color} refId={l.partner.refId} />
                      : l.mlsStatus === "kept" ? <span className="text-xs font-semibold text-warn">Unmatched</span>
                      : <span className="text-xs text-text-3">—</span>}
                  </Td>
                  {/* TAG-04/TAG-05: uncapped on the list (there is room); the Hot smart tag
                      renders from the row's own score fields, for KEPT leads only — the same
                      rule the HotLeadMark beside the ref follows. */}
                  <Td>
                    <LeadTags
                      editable
                      tags={l.tags}
                      hot={l.mlsStatus === "kept" && l.scoreGroup === "hot"}
                      hotScore={l.scoreTotal}
                      options={allTags}
                      busy={busy}
                      onAttach={(tagId) => attach.mutate({ refId: l.refId, tagId })}
                      onDetach={(tagId) => detach.mutate({ refId: l.refId, tagId })}
                      onCreate={(name) => createAndAttach.mutate({ refId: l.refId, name })}
                    />
                  </Td>
                  <Td fit align="right"><span className="num text-xs text-text-3 tabular-nums">{fmtDate(l.receivedAt)}</span></Td>
                  <Td fit align="right"><span className="num text-xs text-text-3 tabular-nums">{l.modifiedAt ? fmtDate(l.modifiedAt) : "—"}</span></Td>
                  <Td fit><StatusSelect refId={l.refId} status={l.status} mlsStatus={l.mlsStatus} /></Td>
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
