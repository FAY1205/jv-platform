"use client";

import * as React from "react";
import { useQuery, keepPreviousData, type UseQueryResult } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/dates";
import { LEAD_STATUS_FILTERS, DEFAULT_STATUS_FILTERS, isDefaultStatuses, type LeadSortField } from "@/modules/leads/schema";
import { leadsQueryParams } from "@/modules/leads/filter-wire";
import {
  AppShell, Card, Table, THead, TBody, Th, Tr, Td, PartnerTag, EmptyState, ClearFiltersButton, QueryErrorState, Skeleton,
  Input, Checkbox, Combobox, DateRangePicker, Pagination, RowOpenButton, StatusSelect, SegmentedControl,
  DEFAULT_PAGE_SIZE, usePageHeader, FilterPill, Tooltip, HotLeadIcon, StatusFilterMenu,
  LeadTags, TagChip, TagPicker, SavedViewsMenu, ColumnsMenu, type ColumnDef, type LeadTagView,
} from "@/components";
import { useCurrentUser } from "@/lib/use-current-user";
import { BulkBar } from "./bulk-bar";
import {
  LEADS_APPLY_VIEW_EVENT, LEADS_CLEAR_FILTERS_EVENT, LEADS_OPEN_COLUMNS_EVENT,
  type LeadsApplyViewDetail,
} from "@/lib/leads-actions";
import { useSavedViews } from "@/lib/saved-views-client";
import type { SavedViewFilters } from "@/modules/saved-views/schema";
import { US_STATES } from "@/lib/us-states";
import { googleSearchUrl } from "@/lib/search-links";
import { setPreferences, usePreferences, type LeadsViewPref } from "@/lib/preferences";
import { useLeadNavCounts } from "@/lib/lead-counts";
import { rowClickGuard, CLICKABLE_ROW_CLASS } from "@/lib/row-click";
import { useTags, useLeadTagMutations, atTagLimit } from "@/lib/tags-client";
import { useLeadNav } from "./lead-pager";

const LeadDialog = dynamic(() => import("./lead-dialog").then((m) => m.LeadDialog), { ssr: false });
// KAN-01: the board is a second view of the SAME page — code-split like the dialog so
// list-only sessions never pay for it.
const LeadsBoard = dynamic(() => import("./leads-board").then((m) => m.LeadsBoard), { ssr: false });

// ADM: the global leads list. The filter bar is isolated from the table so search
// keystrokes don't reconcile the body (F-54); rows open via a keyboard button (F-14);
// status is a pill Select; pagination has rows-per-page (FEP-03). Server-side
// filtered/sorted/paged; the LeadDialog is code-split (F-56).

// Exported for C-41b: lead-placeholder.ts reshapes a cached row of this list into the
// partial detail the dialog paints while the real one loads (type-only import there).
export interface LeadRow {
  refId: string; seller: string; address: string; city: string | null; state: string | null;
  zip: string | null; campaign: string | null; mlsStatus: "kept" | "removed"; status: string;
  scoreTotal: number | null; scoreGroup: "hot" | "warm" | "nurture" | null;
  partner: { id: string; name: string; refId: string; color: string } | null;
  receivedAt: string; modifiedAt: string | null;
  /** TAG-04: the row's chips, ordered by lower(name) server-side. */
  tags: LeadTagView[];
}
export interface LeadsPage { leads: LeadRow[]; page: number; pageSize: number; total: number }
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

// The leads table's column roster. Lead + Status are PINNED (the row's open affordance/key and
// its workflow control); the rest are user-hideable via the Columns menu, persisted in the one
// UI-preferences store (PRN-15). Default = every column visible = today's table, so the feature
// changes nothing for anyone who never opens the menu. (Reorder/resize deliberately out of scope
// here — the Table's fit/clamp width budget owns sizing; reorder is a future additive `order`.)
const LEADS_COLUMNS: readonly ColumnDef[] = [
  { id: "lead", label: "Lead", pinned: true },
  { id: "seller", label: "Seller" },
  { id: "property", label: "Property" },
  { id: "partner", label: "Partner" },
  { id: "tags", label: "Tags" },
  { id: "received", label: "Received" },
  { id: "modified", label: "Modified" },
  { id: "status", label: "Status", pinned: true },
];

interface LeadsViewProps {
  initialQ: string;
  initialOpenRef?: string | null;
  initialHot?: boolean;
  /** UXF-11.1: tag ids from `?tags=`, already parsed + bounded by the SHARED parser the two
   *  leads endpoints use. Deep-links into a tag-filtered list (Settings → Tags usage counts). */
  initialTags?: readonly string[];
  /** N3C-05/C-69: partner id (or the "unmatched" sentinel) from `?partnerId=`, already
   *  validated by the SHARED `partnerIdParam()`. "" = no partner filter. Deep-links into a
   *  partner-filtered list (partner detail → "View all in Leads →"). */
  initialPartnerId?: string;
  /** N6-72: a saved-view id from `?view=` (the Ctrl-K palette's "Apply view", arriving from a
   *  page where this list wasn't mounted to receive the event). Applied once the roster loads;
   *  an id that isn't in the user's own roster is a silent no-op. */
  initialViewId?: string | null;
}

export function LeadsView({ initialQ, initialOpenRef = null, initialHot = false, initialTags = [], initialPartnerId = "", initialViewId = null }: LeadsViewProps) {
  return (
    <AppShell>
      <LeadsBody initialQ={initialQ} initialOpenRef={initialOpenRef} initialHot={initialHot} initialTags={initialTags} initialPartnerId={initialPartnerId} initialViewId={initialViewId} />
    </AppShell>
  );
}

// Rendered inside AppShell's PageHeaderProvider so usePageHeader resolves — the "Leads"
// title lives in the topbar (WP-E shell pattern), so no in-body <h1>.
function LeadsBody({ initialQ, initialOpenRef = null, initialHot = false, initialTags = [], initialPartnerId = "", initialViewId = null }: LeadsViewProps) {
  usePageHeader({ title: "Leads" });

  const [filters, setFilters] = React.useState<Filters>({ ...EMPTY, q: initialQ, hot: initialHot, tags: [...initialTags], partnerId: initialPartnerId });
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

  // N6-50: the selection lives HERE (not in the table) — the panel, the bar and the table are
  // all this component's children, and the escalated flag has to survive a page change.
  // `selected` holds REF ids, the identity the rest of the product uses.
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [allMatching, setAllMatching] = React.useState(false);

  const filterKey = `${filters.q}|${filters.partnerId}|${filters.state}|${filters.source}|${filters.statuses.join(",")}|${filters.hot}|${filters.tags.join(",")}|${filters.dateFrom}|${filters.dateTo}|${sort}|${dir}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  // N6-51 (owner A5): the selection survives PAGING and dies on any filter/sort change — the
  // same render-time compare that already resets `page` (the Unmatched-page contract). Rows
  // the operator can no longer see must not stay selected under a bulk action.
  if (filterKey !== resetKey) { setResetKey(filterKey); setPage(1); setSelected(new Set()); setAllMatching(false); }

  const clearSelection = React.useCallback(() => { setSelected(new Set()); setAllMatching(false); }, []);
  // Touching any row/page checkbox while escalated drops back to page mode with that gesture
  // applied — the escalation is a claim about a filter, and a hand edit contradicts it.
  const editSelection = React.useCallback((edit: (prev: Set<string>) => void) => {
    setAllMatching(false);
    setSelected((prev) => { const next = new Set(prev); edit(next); return next; });
  }, []);

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

  // C-54: the filtered-to-zero table's way out. It is NOT a second reset — it pushes EMPTY
  // down the SV-04 apply channel, the same one-way path "Clear all" and a saved view use, so
  // the bar's own `clearAll` and this button write byte-identical state. The current view
  // mode is preserved: clearing filters is not a request to change List/Board.
  const clearFilters = React.useCallback(() => applyView({ ...EMPTY, viewMode: view }), [applyView, view]);

  // ── N6-72: the Ctrl-K palette's leads actions ────────────────────────────────────────────
  // The palette is mounted by the (admin) layout, OUTSIDE this tree, so it reaches us by window
  // event (lib/leads-actions). Each one routes through a channel that already exists — the
  // SV-04 apply path or the Columns menu's new controlled `open` — so a palette action and the
  // equivalent click land in exactly the same state. Nothing here writes.
  const [columnsOpen, setColumnsOpen] = React.useState(false);
  React.useEffect(() => {
    const onApply = (e: Event) => {
      const detail = (e as CustomEvent<LeadsApplyViewDetail>).detail;
      if (detail?.filters) applyView(detail.filters);
    };
    const onClear = () => clearFilters();
    // Board mode has no columns menu to open, so the request is dropped rather than parked —
    // otherwise it would spring open later, on a switch back to the list, long after the ask.
    const onColumns = () => { if (view === "list") setColumnsOpen(true); };
    window.addEventListener(LEADS_APPLY_VIEW_EVENT, onApply);
    window.addEventListener(LEADS_CLEAR_FILTERS_EVENT, onClear);
    window.addEventListener(LEADS_OPEN_COLUMNS_EVENT, onColumns);
    return () => {
      window.removeEventListener(LEADS_APPLY_VIEW_EVENT, onApply);
      window.removeEventListener(LEADS_CLEAR_FILTERS_EVENT, onClear);
      window.removeEventListener(LEADS_OPEN_COLUMNS_EVENT, onColumns);
    };
  }, [applyView, clearFilters, view]);

  // N6-72: `?view=<id>` — the same action arriving from a page where this list wasn't mounted.
  // The roster read shares SavedViewsMenu's cache entry (one fetch), and the id is matched
  // against rows the SERVER already scoped to this user: an unknown or someone else's id
  // simply finds nothing and the page opens at its default. Seeded once per id, so closing or
  // editing the applied view isn't undone on the next render.
  const savedViewsQ = useSavedViews(Boolean(initialViewId));
  // "Which param have I already consumed" is a REF, not state: it renders nothing, and holding
  // it in state would mean a setState inside this effect — a cascading render for a value no
  // one displays (the ?open= re-seed above can use the render-time compare instead because it
  // has no side effect to perform; applying a view writes the view-mode preference).
  const seededViewRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!initialViewId || seededViewRef.current === initialViewId) return;
    const rows = savedViewsQ.data?.views;
    if (!rows) return; // the roster hasn't landed yet — try again when it does
    seededViewRef.current = initialViewId;
    const match = rows.find((v) => v.id === initialViewId);
    // The apply MUST go through this one channel (it writes the view-mode preference as well as
    // the filter nonce), and it cannot run during render because the roster it depends on
    // arrives from a server response. The rule's "cascading render" concern doesn't bite here:
    // the ref above makes this fire at most once per URL param, never in a loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep-link seed; the guard ref bounds it
    if (match) applyView(match.filters);
  }, [initialViewId, savedViewsQ.data, applyView]);

  // N5-04: the panel's pager and the table read the SAME list query — one cache entry, one
  // fetch — so "N of M" can never disagree with the rows on screen. It lives here rather than
  // in LeadsTable because the panel is this component's child too. Board mode doesn't run it:
  // the board is its own working set, and a list pager over it would be a different number.
  const list = view === "list";
  const leadsQ = useLeadsPage({ filterKey, filters, sort, dir, page, pageSize, enabled: list });
  const nav = useLeadNav({
    data: list ? leadsQ.data : undefined,
    isError: Boolean(leadsQ.error),
    openRef,
    onOpen: setOpenRef,
    onPageChange: setPage,
  });

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

      {/* seedTags is passed as a CSV string, not an array: the bar is React.memo'd, and a
          fresh array literal per render would defeat that on every unrelated re-render. */}
      <LeadsFilterBar seedQ={initialQ} seedHot={initialHot} seedTags={initialTags.join(",")} seedPartnerId={initialPartnerId} view={view} applied={applied} onChange={setFilters} />

      {view === "board" ? (
        // WP-UX-3 (audit 2.3): the board carries the WHOLE committed filter set — one filter
        // bar, two views. `statuses` alone stays list-only (the columns are the status filter).
        <LeadsBoard
          filters={{
            partnerId: filters.partnerId,
            hot: filters.hot,
            tags: filters.tags,
            q: filters.q,
            state: filters.state,
            source: filters.source,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
          }}
          onOpen={setOpenRef}
        />
      ) : (
        <LeadsTable
          leadsQ={leadsQ}
          filters={filters}
          sort={sort}
          dir={dir}
          openRef={openRef}
          onSort={onSort}
          onOpen={setOpenRef}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          onClearFilters={clearFilters}
          selected={selected}
          allMatching={allMatching}
          onEditSelection={editSelection}
          onEscalate={() => setAllMatching(true)}
          onClearSelection={clearSelection}
          columnsOpen={columnsOpen}
          onColumnsOpenChange={setColumnsOpen}
        />
      )}

      {/* N5-02: the record lives in a NON-MODAL side panel now, so this stays mounted across a
          record switch — clicking another row while it is open changes `openRef` and the panel
          re-keys its queries in place instead of closing and reopening. The `?open=` discipline
          above is untouched. */}
      {openRef && <LeadDialog refId={openRef} onClose={closeDialog} nav={nav} />}
    </>
  );
}

// ── Filter bar (isolated; owns raw text + debounce, lifts committed filters) ──
const LeadsFilterBar = React.memo(function LeadsFilterBar({ seedQ, seedHot = false, seedTags = "", seedPartnerId = "", view = "list", applied = null, onChange }: { seedQ: string; seedHot?: boolean; seedTags?: string; seedPartnerId?: string; view?: LeadsViewPref; applied?: AppliedView | null; onChange: (f: Filters) => void }) {
  // WP-UX-3 (audit 2.3): the board now honours the WHOLE filter set, so every control
  // stays visible in both modes. The one exception: the status pills are list-only —
  // the board's columns already express status, and two answers to "which statuses am
  // I looking at" would be worse than one.
  const listOnly = view === "list";
  const [qInput, setQInput] = React.useState(seedQ);
  // Partner / Source / State are ALL searchable Comboboxes (owner: make them match) — one
  // control shape, "" = the "All …" placeholder, selection commits directly (no debounce).
  const [state, setState] = React.useState("");
  // N3C-05/C-69: seeded from `?partnerId=` on first mount (the partner-detail "View all in
  // Leads →" deep link). A seed only — user edits and saved views take over, exactly like
  // ?q= and ?tags=. The bar commits its whole set upward on mount, so seeding it HERE (not
  // only in the parent's initial Filters) is what stops that first commit from clearing it.
  const [partnerId, setPartnerId] = React.useState(seedPartnerId);
  const [source, setSource] = React.useState("");
  const [statuses, setStatuses] = React.useState<string[]>([...DEFAULT_STATUS_FILTERS]);
  const [hot, setHot] = React.useState(seedHot);
  // TAG-03: selected tag ids (any-of). Carried in BOTH modes — the board honours them too.
  // UXF-11.1: seeded from `?tags=` on first mount (the Settings → Tags usage-count deep
  // link). A seed only — user edits and saved views take over from here, exactly like ?q=.
  const [tagIds, setTagIds] = React.useState<string[]>(() => (seedTags ? seedTags.split(",") : []));
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

  // The ONE place that writes every control here from a Filters set. Applying a saved view,
  // "Clear all", and C-54's empty-state Clear filters (which rides the apply channel with
  // EMPTY) are the same operation with different inputs — so they cannot drift apart. The
  // committed text is set alongside the input so the trailing debounce can't re-commit the
  // pre-apply search; the commit effect below lifts the whole set upward in one pass.
  const seedFrom = (f: Filters) => {
    setQInput(f.q); setQCommitted(f.q);
    setState(f.state); setPartnerId(f.partnerId); setSource(f.source);
    setStatuses([...f.statuses]); setHot(f.hot); setTagIds([...f.tags]);
    setRange({ from: f.dateFrom || null, to: f.dateTo || null });
  };

  // SV-04: applying a saved view REPLACES every control here — including the ones board mode
  // hides, so switching back to the list shows the view, not a leftover. Keyed on the NONCE
  // (the `seeded` idiom above), so re-applying the same view still resets an edited bar.
  const [appliedNonce, setAppliedNonce] = React.useState(applied?.n ?? 0);
  if (applied && applied.n !== appliedNonce) {
    setAppliedNonce(applied.n);
    seedFrom(applied.filters);
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

  const clearAll = () => seedFrom(EMPTY);

  // Commit filters upward whenever a committed value changes. On "Clear all" the committed
  // text is reset in the same batch, so this fires once with the default (not empty) set.
  React.useEffect(() => {
    onChange({ q: qCommitted, state, partnerId, source, statuses, hot, tags: tagIds, dateFrom: range.from ?? "", dateTo: range.to ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qCommitted, state, partnerId, source, statuses.join(","), hot, tagIds.join(","), range.from, range.to]);

  // "Filters active" ignores the default status selection — only a change from it counts.
  const hasFilters = Boolean(qInput || state || partnerId || source || hot || tagIds.length || !isDefaultStatuses(statuses) || range.from);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2.5">
        <div className="w-full max-w-[300px]">
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onClear={() => { setQInput(""); setQCommitted(""); }}
            placeholder="Search seller, address, ZIP, phone, lead ID…"
            aria-label="Search leads"
          />
        </div>
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
        {/* WP-UX-6: the status filter is a multi-select (owner direction) — a calm
            summary trigger + removable deviation chips, not a wall of active pills. The
            board hides it entirely: its COLUMNS already express status, so one answer to
            "which statuses am I looking at". */}
        {listOnly && (
          <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <StatusFilterMenu
              options={LEAD_STATUS_FILTERS}
              defaultValue={DEFAULT_STATUS_FILTERS}
              value={statuses}
              onChange={setStatuses}
            />
          </>
        )}
      </div>
    </>
  );
});

/** The list query. Lifted out of LeadsTable (N5-04) so the panel's pager subscribes to the SAME
 *  cache entry the table renders — same key, one fetch, no second source of truth (PRN-15). */
function useLeadsPage({
  filterKey, filters, sort, dir, page, pageSize, enabled,
}: {
  filterKey: string; filters: Filters; sort: LeadSortField; dir: "asc" | "desc"; page: number; pageSize: number; enabled: boolean;
}) {
  return useQuery({
    queryKey: ["leads", filterKey, page, pageSize],
    // N6-50: the SHARED serializer (modules/leads/filter-wire), the same module the bulk
    // bar's `mode:"filter"` body comes from — so the count this query reports and the set an
    // escalated write touches are two renderings of one definition.
    queryFn: () => apiGet<LeadsPage>(`/api/leads?${leadsQueryParams(filters, { sort, dir, page, pageSize })}`),
    // Perf: paging/sorting/filtering keeps the prior page visible (and its "N leads" count) instead of
    // wiping the table to skeletons on every change (mirrors portal-dashboard). isPending only fires
    // on the very first load; subsequent fetches are background refetches over the kept data.
    placeholderData: keepPreviousData,
    enabled,
  });
}

// ── Table (consumes only committed state → no keystroke reconciliation) ──
function LeadsTable({
  leadsQ, filters, sort, dir, openRef, onSort, onOpen, onPageChange, onPageSizeChange, onClearFilters,
  selected, allMatching, onEditSelection, onEscalate, onClearSelection, columnsOpen, onColumnsOpenChange,
}: {
  leadsQ: UseQueryResult<LeadsPage, Error>;
  filters: Filters; sort: LeadSortField; dir: "asc" | "desc";
  /** N5-02: the lead the (non-modal) panel is showing — the table marks it, since both are on screen. */
  openRef: string | null;
  onSort: (f: LeadSortField) => void; onOpen: (ref: string) => void; onPageChange: (p: number) => void; onPageSizeChange: (n: number) => void;
  /** C-54: resets the filter bar through the page's single apply channel. */
  onClearFilters: () => void;
  /** N6-50: the selection is the page's state; the table only renders and edits it. */
  selected: ReadonlySet<string>;
  allMatching: boolean;
  onEditSelection: (edit: (next: Set<string>) => void) => void;
  onEscalate: () => void;
  onClearSelection: () => void;
  /** N6-73: the Columns menu is CONTROLLED here so the Ctrl-K palette can raise it (the page
   *  owns the event listener; the menu itself is three levels down). */
  columnsOpen: boolean;
  onColumnsOpenChange: (open: boolean) => void;
}) {
  const data = leadsQ.data;
  const { canDo } = useCurrentUser();
  // N6-52: the column exists only for seats that can ACT on a selection. PR B widens this to
  // `|| canDo("data.export")` when Export joins the bar; until then a checkbox for an
  // export-only seat would select rows nothing could be done with. Fail-closed while /api/me
  // is in flight (useCurrentUser's contract), so it appears rather than disappears.
  const selectable = canDo("leads.write");
  const pageRefs = React.useMemo(() => (data?.leads ?? []).map((l) => l.refId), [data]);
  // While escalated every visible row IS selected, so the checkboxes must read that way even
  // though `selected` holds no ids (N6-50: the escalated selection is a filter, not a list).
  const selectedOnPage = allMatching ? pageRefs.length : pageRefs.filter((r) => selected.has(r)).length;
  const allPageSelected = pageRefs.length > 0 && selectedOnPage === pageRefs.length;
  /**
   * N6-51: any checkbox gesture drops out of escalated mode. Materializing THIS page first is
   * what makes the drop-back non-destructive — un-ticking one row of an "all 641" selection
   * leaves the rest of the page selected, rather than silently clearing everything the
   * operator could see.
   */
  const editRows = (edit: (next: Set<string>) => void) =>
    onEditSelection((next) => {
      if (allMatching) for (const r of pageRefs) next.add(r);
      edit(next);
    });
  const togglePage = (on: boolean) =>
    editRows((next) => { for (const r of pageRefs) { if (on) next.add(r); else next.delete(r); } });
  // N3C-01/Q3: the workspace total, read from the SAME ["leads","counts"] cache entry the
  // shell's nav badges use (lib/lead-counts) — no second endpoint hit, and the header can
  // never disagree with the badge.
  const workspaceTotal = useLeadNavCounts().data?.total ?? null;
  const hasFilters = Boolean(filters.q || filters.partnerId || filters.state || filters.source || filters.hot || filters.tags.length || !isDefaultStatuses(filters.statuses) || filters.dateFrom);
  const sortDir = (f: LeadSortField) => (sort === f ? dir : null);
  // The SAME cache entry the filter bar reads (TAGS_KEY) — one roster fetch for the page,
  // handed to every row's picker.
  const tagsQ = useTags();
  const allTags = tagsQ.data?.tags ?? [];
  // TAG-08: one predicate for every row's picker, derived from the roster payload's own
  // `total`/`limit` — the cap is never duplicated client-side.
  const tagsAtLimit = atTagLimit(tagsQ.data);
  const { attach, detach, createAndAttach, busy } = useLeadTagMutations();

  // User-hidden columns (a UI preference — §6.17). `shown` gates the pinned columns too so a
  // stray stored id can never hide the Lead/Status columns.
  const hiddenColumns = usePreferences().leadsColumns.hidden;
  const shown = (id: string) => LEADS_COLUMNS.find((c) => c.id === id)?.pinned || !hiddenColumns.includes(id);
  const toggleColumn = (id: string, visible: boolean) =>
    setPreferences({ leadsColumns: { hidden: visible ? hiddenColumns.filter((x) => x !== id) : [...new Set([...hiddenColumns, id])] } });
  const resetColumns = () => setPreferences({ leadsColumns: { hidden: [] } });

  return (
    <>
      {/* Live result count (owner note #2) + the Columns control. The count re-announces as
          filters narrow the set; it is suppressed at zero and on error (D2 — the EmptyState
          announces those), while the Columns menu stays available whenever the table has data. */}
      {data && !leadsQ.error && (
        <div className="mb-2 flex min-h-[1.5rem] items-center justify-between gap-2">
          <p className="text-step-1 text-text-3" aria-live="polite">
            {data.total > 0 && (
              // N3C-01/Q3: at the DEFAULT filter state the list is the workspace's ACTIVE
              // leads (Removed MLS is filtered out), and the sidebar badge now says so too.
              // Naming both numbers is what makes the gap self-explanatory instead of a
              // discrepancy the reader has to reconcile. `data.total` IS the active count by
              // construction (the same predicate produced the rows); `workspaceTotal` comes
              // from the shared counts cache the shell already populated — one server-side
              // source, no client-side arithmetic (PRN-15). It is omitted until that cache
              // settles rather than printed as a placeholder zero.
              <>
                <span className="num font-semibold text-text-2">{data.total.toLocaleString()}</span>{" "}
                {!hasFilters && workspaceTotal !== null ? (
                  <>
                    {data.total === 1 ? "active lead" : "active leads"}
                    {" · "}
                    <span className="num font-semibold text-text-2">{workspaceTotal.toLocaleString()}</span> total
                  </>
                ) : (
                  <>
                    {data.total === 1 ? "lead" : "leads"}{hasFilters ? " match the filters" : ""}
                  </>
                )}
              </>
            )}
          </p>
          <ColumnsMenu
            columns={LEADS_COLUMNS}
            hidden={hiddenColumns}
            onToggle={toggleColumn}
            onReset={resetColumns}
            open={columnsOpen}
            onOpenChange={onColumnsOpenChange}
          />
        </div>
      )}
      {/* N6-53: the bar sits BETWEEN the count row and the table — it belongs to the rows it
          acts on, and putting it above the Card keeps it visible while the table scrolls. */}
      {selectable && data && !leadsQ.error && (
        <BulkBar
          filters={filters}
          total={data.total}
          selected={selected}
          allMatching={allMatching}
          onEscalate={onEscalate}
          onClear={onClearSelection}
          onApplied={onClearSelection}
        />
      )}
      <Card>
        {leadsQ.isPending ? (
          <div className="flex flex-col gap-3 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : leadsQ.error ? (
          <div className="p-6"><QueryErrorState title="Couldn't load leads" error={leadsQ.error} onRetry={() => leadsQ.refetch()} /></div>
        ) : data!.leads.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No leads found"
              description={hasFilters ? "Try widening the filters." : "Process a weekly file to see leads here."}
              // C-54: filtered to nothing is a dead end without this — the filters that emptied
              // the table can be spread across the bar, the chips and a saved view.
              action={hasFilters ? <ClearFiltersButton onClick={onClearFilters} /> : undefined}
            />
          </div>
        ) : (
          // C-53: up to eight columns. `min-w-[760px]` is the point below which the percentage
          // columns (Seller 16% / Property 32% / Partner 14% / Tags 16%) stop being readable
          // and Status — the row's workflow control — starts falling off; the fade makes that
          // clipping visible instead of leaving the table looking amputated. N6-52's checkbox
          // is a `fit` column ~28px wide, so the budget above is unchanged for read-only seats
          // and only shifts by that much for seats that can act.
          <Table className={selectable ? "min-w-[788px]" : "min-w-[760px]"} ariaLabel="Leads" scrollHint>
            {/* WP-UX-1 width budget (audit T1): IDs/dates/status take content width
                (`fit`), Seller/Property/Partner absorb the leftover and ellipsize
                (`clamp`) — a date never wraps to two lines, a name never wraps while
                a neighbor column sits half-empty. Tags stays auto: chips wrap in place. */}
            <THead>
              <Tr>
                {selectable && (
                  <Th fit>
                    {/* N6-52: tri-state. A partly-selected page reads as "mixed" to AT and
                        draws a dash; activating it completes the page rather than clearing it,
                        which is the gesture an operator means from a partial state. */}
                    <Checkbox
                      checked={allPageSelected}
                      indeterminate={selectedOnPage > 0 && !allPageSelected}
                      onCheckedChange={(on) => togglePage(selectedOnPage > 0 && !allPageSelected ? true : on)}
                      ariaLabel="Select all leads on this page"
                    />
                  </Th>
                )}
                <Th fit sortable sortDir={sortDir("lead")} onSort={() => onSort("lead")}>Lead</Th>
                {shown("seller") && <Th sortable sortDir={sortDir("seller")} onSort={() => onSort("seller")} className="w-[16%]">Seller</Th>}
                {shown("property") && <Th className="w-[32%]">Property</Th>}
                {/* Partner is now a name-only cell (owner: drop the swatch + refId chrome from the
                    dense row) — a quarter of the table's width was more than a name needs. */}
                {shown("partner") && <Th className="w-[14%]">Partner</Th>}
                {shown("tags") && <Th className="w-[16%]">Tags</Th>}
                {shown("received") && <Th fit sortable sortDir={sortDir("received")} onSort={() => onSort("received")} align="right">Received</Th>}
                {shown("modified") && <Th fit sortable sortDir={sortDir("modified")} onSort={() => onSort("modified")} align="right">Modified</Th>}
                <Th fit>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {data!.leads.map((l) => (
                // N3C-02/Q5: the whole row opens the lead. Pointer convenience only — the
                // keyboard/AT path is still the RowOpenButton in the first cell (so no
                // tabIndex/role here); rowClickGuard defers to inner controls and to an
                // in-progress text selection (lib/row-click).
                // N5-02: the panel is non-modal, so the row it is showing has to be findable in
                // the table beside it. `aria-current` carries that to AT, and the ref in the
                // panel header names the same lead — the tint is never the only signal (PRN-14).
                <Tr
                  key={l.refId}
                  aria-current={l.refId === openRef ? "true" : undefined}
                  aria-selected={selectable ? selected.has(l.refId) || allMatching : undefined}
                  className={cn(
                    "group",
                    CLICKABLE_ROW_CLASS,
                    // N6-54: the SELECTED wash is brand-soft. The open record now carries a
                    // ring instead, so the two marks are distinguishable and can coexist on
                    // one row (both also carry a non-colour signal: aria-current / the count
                    // in the bar — PRN-14).
                    (selected.has(l.refId) || allMatching) && "bg-brand-soft",
                    l.refId === openRef && "ring-1 ring-inset ring-brand",
                  )}
                  onClick={(e) => { if (rowClickGuard(e.target)) onOpen(l.refId); }}
                >
                  {selectable && (
                    <Td fit>
                      {/* rowClickGuard already defers to [role=checkbox] (lib/row-click), so
                          selecting a row never also opens it — nothing to re-implement here. */}
                      <Checkbox
                        checked={selected.has(l.refId) || allMatching}
                        onCheckedChange={(on) => editRows((next) => { if (on) next.add(l.refId); else next.delete(l.refId); })}
                        ariaLabel={`Select ${l.refId}`}
                      />
                    </Td>
                  )}
                  <Td fit>
                    <span className="inline-flex items-center gap-1.5">
                      <RowOpenButton className="text-xs" onClick={() => onOpen(l.refId)}>{l.refId}</RowOpenButton>
                    </span>
                  </Td>
                  {shown("seller") && <Td clamp clampTitle={l.seller}><span className="text-sm text-text">{l.seller}</span></Td>}
                  {/* One flowing line, single wrap point (audit 4.3): street + muted
                      city/state/zip as inline runs that truncate together — the city
                      fragment no longer lands at a different x-offset per row. */}
                  {shown("property") && (
                    <Td clamp>
                      <Tooltip content="Search this property on Google">
                        <a href={googleSearchUrl([l.address, l.city, l.state, l.zip])} target="_blank" rel="noopener noreferrer" className="group hover:underline">
                          <span className="text-sm text-text-2 group-hover:text-brand-ink">{l.address}</span>{" "}
                          <span className="text-xs text-text-3">{[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span></span>
                        </a>
                      </Tooltip>
                    </Td>
                  )}
                  {/* Owner: no partner swatch + refId in the dense row — name only (PartnerTag
                      variant="name" keeps the refId in the cell title/aria, and PRN-14 holds
                      because the row carries no color to accompany). Full identity stays on the
                      board card, the lead dialog, the portal, exports and the coverage map. */}
                  {shown("partner") && (
                    <Td clamp>
                      {l.partner ? <PartnerTag variant="name" size="sm" name={l.partner.name} color={l.partner.color} refId={l.partner.refId} />
                        : l.mlsStatus === "kept" ? <span className="text-xs font-semibold text-warn">Unmatched</span>
                        : <span className="text-xs text-text-3">—</span>}
                    </Td>
                  )}
                  {/* TAG-04/TAG-05: dense single-line chips (cap 2 + "+n", each clamped) so the
                      row height never jitters (owner: "tags render awkwardly"). The Hot smart tag
                      renders from the row's own score fields, for KEPT leads only. */}
                  {shown("tags") && (
                    <Td>
                      <LeadTags
                        dense
                        editable
                        quietAdd
                        tags={l.tags}
                        hot={l.mlsStatus === "kept" && l.scoreGroup === "hot"}
                        hotScore={l.scoreTotal}
                        options={allTags}
                        atLimit={tagsAtLimit}
                        busy={busy}
                        onAttach={(tagId) => attach.mutate({ refId: l.refId, tagId })}
                        onDetach={(tagId) => detach.mutate({ refId: l.refId, tagId })}
                        onCreate={(name) => createAndAttach.mutate({ refId: l.refId, name })}
                      />
                    </Td>
                  )}
                  {shown("received") && <Td fit align="right"><span className="num text-xs text-text-3 tabular-nums">{fmtDate(l.receivedAt)}</span></Td>}
                  {shown("modified") && <Td fit align="right"><span className="num text-xs text-text-3 tabular-nums">{l.modifiedAt ? fmtDate(l.modifiedAt) : "—"}</span></Td>}
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
