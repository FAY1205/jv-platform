"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { statusDotClass } from "@/lib/status-pill";
import { BOARD_COLUMNS, BOARD_PAGE_SIZE, DRAG_CLICK_THRESHOLD_PX, boardAge, isTerminalStatus } from "@/modules/leads/board";
import {
  Card, EmptyState, PartnerTag, QueryErrorState, RowOpenButton, Skeleton, useToast,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  LeadTags, type LeadTagView,
} from "@/components";
import { useTags, useLeadTagMutations } from "@/lib/tags-client";

/** TAG-04: a card shows at most two chips; the rest collapse into "+n" (a card is 15rem
 *  wide — an unbounded chip row would push the partner + age lines off it). */
const CARD_TAG_CAP = 2;

// ADM · WP-KAN-1: the Leads BOARD — the same leads the list serves, in six fixed
// columns keyed on their current status (KAN-02). Drag (or the ⋯ "Move to…" menu —
// KAN-05, the keyboard path) appends a status row through the EXISTING
// POST /api/leads/{ref}/status: no new write path, history stays append-only (KAN-04).
//
// Drag is hand-rolled on POINTER events — no new dependency (KAN-07), the SAME house
// precedent as the map's pan/zoom (also pointer-based). This replaced the original
// native-HTML5-DnD implementation, which the owner reported as "doesn't work": native
// DnD silently drops (a rejected drop fires no `drop` event), has no touch support, and
// is untestable under headless automation. The pointer controller is robust across
// mouse + touch and is exercised by both jsdom and real-browser tests. The drop target
// is resolved from the pointer's element (`data-column-status`), never from geometry, so
// the same code path runs in tests (no layout) and in the browser.
//
// Perf (KAN-10): server-paginated per column (25); the optimistic cache update returns
// the SAME object for untouched columns, so a move re-renders only the two columns it
// touches (BoardColumnView is memoized on those references). The drag itself mutates the
// DOM imperatively (data-dragging on the card, data-over on the hovered column) so an
// in-flight drag never re-renders a column — the only React state a drag updates is the
// cursor-following ghost on the board root, which the memoized columns bail out of.

export interface BoardFilters {
  /** "" = all, a partner uuid, or the "unmatched" sentinel — mirrors the list. */
  partnerId: string;
  hot: boolean;
  /** TAG-03: selected tag ids (any-of) — carried over from the list's filter row. */
  tags: string[];
  /** WP-UX-3 (audit 2.3): the board carries the WHOLE list filter set — one filter bar,
   *  two views, nothing on screen silently ignored. `statuses` stays list-only: the
   *  board's columns are the status filter. */
  q: string;
  state: string;
  source: string;
  dateFrom: string;
  dateTo: string;
}

interface BoardCardData {
  refId: string;
  seller: string;
  city: string | null;
  state: string | null;
  partner: { name: string; refId: string; color: string } | null;
  hot: boolean;
  scoreTotal: number | null;
  statusSince: string;
  tags: LeadTagView[];
}
interface BoardColumnData {
  status: string;
  total: number;
  page: number;
  cards: BoardCardData[];
}
interface BoardPayload {
  columns: BoardColumnData[];
  pageSize: number;
}

/** Live state of an in-progress pointer drag. Held in a ref (never React state) so a drag
 *  never re-renders a column — the dragged card and the hovered column are marked via
 *  imperative DOM attributes (data-dragging / data-over), and the only re-render a drag
 *  causes is the cursor-following ghost on the board root. */
interface DragState {
  refId: string;
  from: string;
  seller: string;
  startX: number;
  startY: number;
  pointerId: number | null;
  /** false until the pointer has travelled past DRAG_CLICK_THRESHOLD_PX — a press that
   *  never moves is a click (KAN-06), so no drag begins and the dialog opens. */
  started: boolean;
  /** The card's DOM node, so the drag can dim it and un-dim it without a re-render. */
  cardEl: HTMLElement;
  /** The status column currently under the pointer that would ACCEPT a drop (never the
   *  source column), or null. Resolved from the event target, not geometry. */
  overStatus: string | null;
}

/** The pointerdown handler a card hands its press to — begins a potential drag. Stable
 *  identity (built once on the board) so it never costs the memoized columns a re-render. */
type CardPointerDown = (e: React.PointerEvent, refId: string, from: string, seller: string, cardEl: HTMLElement) => void;

/**
 * TAG-04 — everything a card needs to render + edit its chips, hoisted to the board and
 * passed down as ONE memoized object (KAN-10): the roster is fetched once for the whole
 * board rather than per card, and the callbacks are identity-stable, so adding tags does not
 * cost the memoized columns their re-render discipline.
 */
interface TagContext {
  options: { id: string; name: string; color: string }[];
  busy: boolean;
  onAttach: (refId: string, tagId: string) => void;
  onDetach: (refId: string, tagId: string) => void;
  onCreate: (refId: string, name: string) => void;
}

const boardUrl = (filters: BoardFilters, status: string | null, page: number) => {
  const params = new URLSearchParams();
  if (filters.partnerId) params.set("partnerId", filters.partnerId);
  if (filters.hot) params.set("hot", "1");
  if (filters.tags.length) params.set("tags", filters.tags.join(","));
  if (filters.q) params.set("q", filters.q);
  if (filters.state) params.set("state", filters.state);
  if (filters.source) params.set("source", filters.source);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/api/leads/board${qs ? `?${qs}` : ""}`;
};

/** Cache key per (filters, column, page). The shared "leads-board" first segment lets
 *  one predicate-free filter update or invalidate every page at once. */
const boardKey = (filterKey: string, status: string | null, page: number) =>
  ["leads-board", filterKey, status ?? "all", page] as const;

// ── the board ────────────────────────────────────────────────────────────────

export function LeadsBoard({
  filters,
  onOpen,
  now: nowProp,
}: {
  filters: BoardFilters;
  onOpen: (refId: string) => void;
  /** Injected clock for the pure age helper (KAN-03). Defaults to mount time — held
   *  steady for the board's life so a re-render never reshuffles ages mid-drag. */
  now?: Date;
}) {
  const filterKey = `${filters.partnerId}|${filters.hot}|${filters.tags.join(",")}|${filters.q}|${filters.state}|${filters.source}|${filters.dateFrom}|${filters.dateTo}`;
  const [mountNow] = React.useState(() => new Date());
  const now = nowProp ?? mountNow;

  const boardQ = useQuery({
    queryKey: boardKey(filterKey, null, 1),
    queryFn: () => apiGet<BoardPayload>(boardUrl(filters, null, 1)),
  });

  // How many pages each column has asked for. A COUNT, not server data (§6.17) — the
  // rows themselves stay in the query cache. Reset when the filters change.
  const [pages, setPages] = React.useState<Record<string, number>>({});
  const [seenKey, setSeenKey] = React.useState(filterKey);
  if (seenKey !== filterKey) {
    setSeenKey(filterKey);
    setPages({});
  }

  // `mutate` is identity-stable (unlike the mutation object, which changes as its state
  // does) — so the callbacks below stay stable and the memoized columns hold (KAN-10).
  const { mutate } = useMoveCard();

  // The caller passes a fresh literal each render; pin it to the filter key so column
  // props don't change identity on every board re-render.
  const stableFilters = React.useMemo(() => filters, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = React.useCallback(
    (refId: string, from: string, to: string) => {
      if (from === to) return; // KAN-04: same column is a no-op — no request at all
      mutate({ refId, from, to, filterKey });
    },
    [mutate, filterKey],
  );

  // ── Pointer-drag controller (KAN-04/06/10) ──────────────────────────────────
  // Everything a drag needs lives in refs so an in-flight drag never re-renders a column.
  // The board root (the scroller) scopes the imperative drop-target highlight; onMove is
  // read through a ref so the window listeners keep a stable identity across re-renders.
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const dragState = React.useRef<DragState | null>(null);
  // Latest-onMove ref (kept current in an effect, never written during render) so the
  // window listeners — created once, below — always call the freshest mutation.
  const onMoveRef = React.useRef(onMove);
  React.useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  // The cursor-following drag ghost — the ONE piece of drag state that re-renders the board
  // (never a column: their props are identity-stable, so React.memo bails — KAN-10 holds).
  const [ghost, setGhost] = React.useState<{ x: number; y: number; label: string } | null>(null);

  const clearOver = React.useCallback(() => {
    scrollerRef.current
      ?.querySelectorAll<HTMLElement>("[data-over='true']")
      .forEach((el) => el.removeAttribute("data-over"));
  }, []);
  // clearOver reached through a ref so the once-built listeners always see the current one.
  const clearOverRef = React.useRef(clearOver);
  React.useEffect(() => { clearOverRef.current = clearOver; }, [clearOver]);

  // The window listeners, built ONCE via a state initializer (stable identities so add/remove
  // pair up; a state initializer runs once and is not render-phase ref access). They read the
  // mutable drag state + latest-onMove through refs, so they never need rebinding.
  const [handlers] = React.useState(() => {
    const move = (e: PointerEvent) => {
      const st = dragState.current;
      if (!st) return;
      if (st.pointerId != null && e.pointerId != null && e.pointerId !== st.pointerId) return;
      if (!st.started) {
        if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) <= DRAG_CLICK_THRESHOLD_PX) return;
        // Past the threshold: this is a drag. Dim the card, suppress text selection, and on
        // touch release the implicit pointer capture so move events target the column under
        // the finger (not the origin card) — the drop hit-test depends on it.
        st.started = true;
        st.cardEl.setAttribute("data-dragging", "true");
        document.body.style.userSelect = "none";
        try { st.cardEl.releasePointerCapture?.(e.pointerId); } catch { /* jsdom / unsupported */ }
      }
      setGhost({ x: e.clientX, y: e.clientY, label: st.seller });
      const col = (e.target as HTMLElement | null)?.closest?.("[data-column-status]") as HTMLElement | null;
      const status = col?.getAttribute("data-column-status") ?? null;
      const accepts = Boolean(status) && status !== st.from ? status : null;
      if (accepts !== st.overStatus) {
        clearOverRef.current();
        if (accepts && col) col.setAttribute("data-over", "true");
        st.overStatus = accepts;
      }
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      const st = dragState.current;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      document.body.style.userSelect = "";
      setGhost(null);
      clearOverRef.current();
      dragState.current = null;
      if (!st) return;
      st.cardEl.removeAttribute("data-dragging");
      if (!st.started || e.type === "pointercancel") return;
      // Prefer the last-tracked accepting column; fall back to the release point's column.
      let target = st.overStatus;
      if (!target) {
        const col = (e.target as HTMLElement | null)?.closest?.("[data-column-status]") as HTMLElement | null;
        const s = col?.getAttribute("data-column-status") ?? null;
        target = s && s !== st.from ? s : null;
      }
      if (target && target !== st.from) onMoveRef.current(st.refId, st.from, target);
    };
    return { move, up };
  });

  const onCardPointerDown = React.useCallback<CardPointerDown>((e, refId, from, seller, cardEl) => {
    if (typeof e.button === "number" && e.button > 0) return; // primary button / touch only
    if (dragState.current) return; // one drag at a time
    dragState.current = { refId, from, seller, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, started: false, cardEl, overStatus: null };
    window.addEventListener("pointermove", handlers.move, true);
    window.addEventListener("pointerup", handlers.up, true);
    window.addEventListener("pointercancel", handlers.up, true);
  }, [handlers]);

  // Belt-and-braces: if the board unmounts mid-drag, tear the window listeners down.
  React.useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlers.move, true);
      window.removeEventListener("pointerup", handlers.up, true);
      window.removeEventListener("pointercancel", handlers.up, true);
      document.body.style.userSelect = "";
    };
  }, [handlers]);
  const onLoadMore = React.useCallback((status: string) => {
    setPages((p) => ({ ...p, [status]: (p[status] ?? 1) + 1 }));
  }, []);

  // TAG-04: one roster fetch + one mutation set for the whole board. `mutate` is
  // identity-stable (unlike the mutation object), so these callbacks are too.
  const tagRoster = useTags().data?.tags;
  const { attach, detach, createAndAttach, busy: tagBusy } = useLeadTagMutations();
  const attachTag = attach.mutate;
  const detachTag = detach.mutate;
  const createTag = createAndAttach.mutate;
  const tagCtx = React.useMemo<TagContext>(
    () => ({
      options: tagRoster ?? [],
      busy: tagBusy,
      onAttach: (refId, tagId) => attachTag({ refId, tagId }),
      onDetach: (refId, tagId) => detachTag({ refId, tagId }),
      onCreate: (refId, name) => createTag({ refId, name }),
    }),
    [tagRoster, tagBusy, attachTag, detachTag, createTag],
  );

  const columnsByStatus = React.useMemo(() => {
    const map = new Map<string, BoardColumnData>();
    for (const c of boardQ.data?.columns ?? []) map.set(c.status, c);
    return map;
  }, [boardQ.data]);

  // WP-UX-3 (audit 2.1): a horizontal-overflow cue. Seven columns can't fit at 1440, and
  // silently clipping the terminal statuses read as "the pipeline ends at Closed". The
  // scroller reports whether MORE columns exist to the right; the fade scrim renders only
  // then, and disappears once the user reaches the end. (scrollerRef is declared with the
  // drag controller above — it doubles as the drop-target-highlight scope.)
  const [moreRight, setMoreRight] = React.useState(false);
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const check = () => setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, []);

  if (boardQ.error) {
    return (
      <Card>
        <div className="p-6">
          <QueryErrorState title="Couldn't load the board" error={boardQ.error} onRetry={() => boardQ.refetch()} />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      {/* WP-UX-3: columns flex between a floor and a cap (min-w-56 → max-w-80), so wide
          viewports fit more columns instead of piling slack into one gutter; when they
          still overflow, the fade scrim + the scroller say so instead of a silent clip. */}
      <div className="relative">
        <div
          ref={scrollerRef}
          className="flex items-start gap-3 overflow-x-auto rounded-2xl bg-surface-2 p-4"
          data-testid="leads-board"
        >
          {BOARD_COLUMNS.map((status) => (
          <BoardColumnView
            key={status}
            status={status}
            data={columnsByStatus.get(status)}
            loading={boardQ.isPending}
            pagesLoaded={pages[status] ?? 1}
            filters={stableFilters}
            filterKey={filterKey}
            now={now}
            onCardPointerDown={onCardPointerDown}
            tagCtx={tagCtx}
            onOpen={onOpen}
            onMove={onMove}
            onLoadMore={onLoadMore}
          />
          ))}
        </div>
        {/* KAN continuation cue: token-only gradient over the deck's own surface. */}
        {moreRight && (
          <div
            aria-hidden="true"
            data-testid="board-more-right"
            className="pointer-events-none absolute inset-y-0 right-0 w-14 rounded-r-2xl bg-gradient-to-l from-surface-2 to-transparent"
          />
        )}
      </div>
      {/* The cursor-following drag ghost. Fixed to the viewport, follows the pointer, and
          never intercepts events. Offset so it doesn't sit under the cursor's hit-test. */}
      {ghost && (
        <div
          aria-hidden="true"
          data-testid="board-drag-ghost"
          className="pointer-events-none fixed z-50 max-w-56 truncate rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-xs font-semibold text-text shadow-md"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          {ghost.label}
        </div>
      )}
    </Card>
  );
}

// ── one column ───────────────────────────────────────────────────────────────

interface ColumnProps {
  status: string;
  data: BoardColumnData | undefined;
  loading: boolean;
  pagesLoaded: number;
  filters: BoardFilters;
  filterKey: string;
  now: Date;
  onCardPointerDown: CardPointerDown;
  tagCtx: TagContext;
  onOpen: (refId: string) => void;
  onMove: (refId: string, from: string, to: string) => void;
  onLoadMore: (status: string) => void;
}

const BoardColumnView = React.memo(function BoardColumnView({
  status, data, loading, pagesLoaded, filters, filterKey, now, onCardPointerDown, tagCtx, onOpen, onMove, onLoadMore,
}: ColumnProps) {
  // Drop-target highlight is driven imperatively by the board's drag controller (it sets
  // data-over on the column under the pointer) — so hovering a column during a drag never
  // re-renders any column (KAN-10). The `data-[over=true]:` variant paints the affordance.

  const total = data?.total ?? 0;
  const cards = data?.cards ?? [];
  const loadedPages = Math.max(1, pagesLoaded);
  const hasMore = total > loadedPages * BOARD_PAGE_SIZE;
  const remaining = Math.min(BOARD_PAGE_SIZE, total - loadedPages * BOARD_PAGE_SIZE);

  return (
    <section
      // While the board is loading the total isn't known yet — don't claim "0 leads" over a
      // skeleton (audit: the header read "NEW · 0" while cards were still loading).
      aria-label={loading ? status : `${status} — ${total} ${total === 1 ? "lead" : "leads"}`}
      // WP-UX-3 (audit 2.1/2.2): flexible width (floor 14rem, cap 20rem) so wide viewports
      // fit more columns; viewport-relative height so the deck uses the page instead of
      // stopping at a fixed 34rem with 40% of the screen empty below.
      className="flex max-h-[70dvh] min-h-[20rem] w-60 min-w-56 max-w-80 flex-1 flex-col rounded-lg border border-border bg-bg"
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-2.5">
        {/* Decorative dot — the status WORD is always present (PRN-14). */}
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(status)}`} aria-hidden="true" />
        <h2 className="text-step-0 font-bold uppercase tracking-wide text-text-2">{status}</h2>
        {/* No count while loading — a "0" over skeletons reads as an empty column. */}
        {loading ? <span className="ml-auto h-3 w-4 animate-pulse rounded bg-surface-3" aria-hidden="true" /> : <span className="num ml-auto text-step-0 font-bold text-text-3">{total}</span>}
      </header>

      <div
        data-testid={`board-column-${status}`}
        // The drag controller resolves the drop target from this attribute (no geometry),
        // and paints the drop affordance by toggling data-over on it — no re-render.
        data-column-status={status}
        className="flex min-h-[3.5rem] flex-col gap-2 overflow-y-auto rounded-b-lg px-2 pb-2.5 pt-1 data-[over=true]:outline data-[over=true]:outline-2 data-[over=true]:-outline-offset-4 data-[over=true]:outline-dashed data-[over=true]:outline-brand-line"
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-1" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : cards.length === 0 && loadedPages === 1 ? (
          <EmptyState compact title="No leads" description={`Nothing is in ${status} yet.`} />
        ) : (
          cards.map((c) => (
            <BoardCardView key={c.refId} card={c} status={status} now={now} onCardPointerDown={onCardPointerDown} tagCtx={tagCtx} onOpen={onOpen} onMove={onMove} />
          ))
        )}

        {/* Pages 2..n each own their fetch + error state, so a failed "Load more"
            never blanks the column that already loaded (per-column error). */}
        {Array.from({ length: loadedPages - 1 }, (_, i) => (
          <ColumnExtraPage
            key={i + 2}
            page={i + 2}
            status={status}
            filters={filters}
            filterKey={filterKey}
            now={now}
            onCardPointerDown={onCardPointerDown}
            tagCtx={tagCtx}
            onOpen={onOpen}
            onMove={onMove}
          />
        ))}

        {hasMore && (
          <button
            type="button"
            onClick={() => onLoadMore(status)}
            className="mx-0.5 mt-0.5 rounded-md border border-dashed border-border-strong px-2 py-1.5 text-step-0 font-semibold text-brand-ink outline-none transition-colors hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.99]"
          >
            Load {remaining} more
          </button>
        )}
      </div>
    </section>
  );
});

/** One extra page of a column (the "Load more" result). Its own query, its own
 *  loading/error state — the column above it stays rendered either way. */
function ColumnExtraPage({
  page, status, filters, filterKey, now, onCardPointerDown, tagCtx, onOpen, onMove,
}: {
  page: number;
  status: string;
  filters: BoardFilters;
  filterKey: string;
  now: Date;
  onCardPointerDown: CardPointerDown;
  tagCtx: TagContext;
  onOpen: (refId: string) => void;
  onMove: (refId: string, from: string, to: string) => void;
}) {
  const q = useQuery({
    queryKey: boardKey(filterKey, status, page),
    queryFn: () => apiGet<BoardPayload>(boardUrl(filters, status, page)),
  });

  if (q.isPending) return <Skeleton className="h-20 w-full" />;
  if (q.error) {
    return <QueryErrorState compact title="Couldn't load more" error={q.error} onRetry={() => q.refetch()} />;
  }
  const cards = q.data?.columns.find((c) => c.status === status)?.cards ?? [];
  return (
    <>
      {cards.map((c) => (
        <BoardCardView key={c.refId} card={c} status={status} now={now} onCardPointerDown={onCardPointerDown} tagCtx={tagCtx} onOpen={onOpen} onMove={onMove} />
      ))}
    </>
  );
}

// ── one card ─────────────────────────────────────────────────────────────────

const BoardCardView = React.memo(function BoardCardView({
  card, status, now, onCardPointerDown, tagCtx, onOpen, onMove,
}: {
  card: BoardCardData;
  status: string;
  now: Date;
  onCardPointerDown: CardPointerDown;
  tagCtx: TagContext;
  onOpen: (refId: string) => void;
  onMove: (refId: string, from: string, to: string) => void;
}) {
  // KAN-06: a press that MOVED is a drag, not a click — so a released drag never also
  // opens the dialog. Pointer coords live in a ref (no re-render per pointerdown). The
  // board's controller owns the drag itself and dims this card via data-dragging.
  const pressRef = React.useRef<{ x: number; y: number } | null>(null);
  const age = boardAge(card.statusSince, now);
  // A long dwell in a TERMINAL column (Closed/Dead) is not "stale" — the lead is done, so
  // suppress the ⚠/amber alarm (audit). The dwell label still renders, in neutral ink.
  const showStale = age.stale && !isTerminalStatus(status);
  const where = [card.city, card.state].filter(Boolean).join(", ");

  return (
    <article
      data-testid={`board-card-${card.refId}`}
      onPointerDown={(e) => {
        pressRef.current = { x: e.clientX, y: e.clientY };
        onCardPointerDown(e, card.refId, status, card.seller, e.currentTarget);
      }}
      onClick={(e) => {
        const start = pressRef.current;
        pressRef.current = null;
        // A press that travelled past the threshold was a drag, not a click (KAN-06).
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_CLICK_THRESHOLD_PX) return;
        onOpen(card.refId);
      }}
      className={[
        // `group` hosts the quiet tag-add reveal (WP-UX-3 — the dashed ghost row was the
        // loudest empty chrome on every card; chips render at rest, ＋ appears on hover/focus).
        "group cursor-grab rounded-lg border border-border bg-surface px-2.5 py-2 shadow-xs transition-shadow",
        "hover:border-border-strong hover:shadow-sm active:cursor-grabbing data-[dragging=true]:opacity-45",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5">
        <RowOpenButton
          className="text-step-0"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(card.refId);
          }}
        >
          {card.refId}
        </RowOpenButton>
        <span className="ml-auto">
          <MoveMenu refId={card.refId} status={status} onMove={onMove} />
        </span>
      </div>

      <p className="mt-0.5 truncate text-sm font-semibold text-text">{card.seller}</p>
      {where && <p className="truncate text-step-0 text-text-3">{where}</p>}

      {/* TAG-04/TAG-05: the chip row. The Hot SMART tag lives here now rather than as a bare
          mark beside the ref (the approved mockup's treatment) — one hot signal per card, in
          the same vocabulary as the tags it sits beside. Capped at 2 + "+n" on a 15rem card. */}
      <div className="mt-1.5">
        <LeadTags
          editable
          quietAdd
          tags={card.tags}
          hot={card.hot}
          hotScore={card.scoreTotal}
          max={CARD_TAG_CAP}
          options={tagCtx.options}
          busy={tagCtx.busy}
          onAttach={(tagId) => tagCtx.onAttach(card.refId, tagId)}
          onDetach={(tagId) => tagCtx.onDetach(card.refId, tagId)}
          onCreate={(name) => tagCtx.onCreate(card.refId, name)}
        />
      </div>

      <div className="mt-1.5">
        {card.partner ? (
          <PartnerTag size="sm" name={card.partner.name} color={card.partner.color} refId={card.partner.refId} />
        ) : (
          // KAN-08: an unmatched lead says so in words, never by colour alone (PRN-14).
          <span className="text-step-0 font-semibold text-warn">Unmatched</span>
        )}
      </div>

      {/* KAN-03: stale carries the ⚠ AND the amber tint AND the day count — never colour alone.
          Suppressed in terminal columns (a done lead is not stale). */}
      <p className={`mt-1.5 text-step-0 ${showStale ? "font-bold text-warn" : "text-text-3"}`}>
        {showStale ? "⚠ " : ""}
        {age.label}
      </p>
    </article>
  );
});

/** KAN-05 — the keyboard path. Radix's menu gives arrow-key navigation, type-ahead,
 *  focus return and Escape for free (ADR-0016); drag is never the only way to move a card. */
function MoveMenu({ refId, status, onMove }: { refId: string; status: string; onMove: (refId: string, from: string, to: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${refId}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="grid h-6 w-6 place-items-center rounded text-text-3 outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:ring-1 focus-visible:ring-brand-ink data-[state=open]:bg-surface-2"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Move to…</DropdownMenuLabel>
        {BOARD_COLUMNS.filter((s) => s !== status).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onMove(refId, status, s)}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(s)}`} aria-hidden="true" />
            {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── the move (KAN-04: the EXISTING status endpoint, optimistic + rollback) ────

interface MoveVars {
  refId: string;
  from: string;
  to: string;
  filterKey: string;
}

/** Move `refId` between columns in one cached board page. Untouched columns keep their
 *  IDENTITY so the memoized column views don't re-render (KAN-10). TanStack's structural
 *  sharing would restore identity for a deep-equal clone anyway — returning `c` says the
 *  intent out loud and doesn't rely on that behaviour. The memo wrapper is what the
 *  KAN-10 test actually pins: without it the untouched columns re-render regardless. */
function applyMove(data: BoardPayload, vars: MoveVars, carried: BoardCardData | null): BoardPayload {
  return {
    ...data,
    columns: data.columns.map((c) => {
      if (c.status === vars.from) {
        return { ...c, total: Math.max(0, c.total - 1), cards: c.cards.filter((x) => x.refId !== vars.refId) };
      }
      if (c.status === vars.to) {
        // Only page 1 of the destination gains the card (it sorts to the top — its
        // status just changed); every page of that column gains the count.
        const gains = c.page === 1 && carried && !c.cards.some((x) => x.refId === vars.refId);
        return {
          ...c,
          total: c.total + 1,
          cards: gains ? [{ ...carried!, statusSince: new Date().toISOString() }, ...c.cards] : c.cards,
        };
      }
      return c; // untouched column — same reference, no re-render
    }),
  };
}

function useMoveCard() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (vars: MoveVars) => apiMutate<{ refId: string; status: string }>(`/api/leads/${vars.refId}/status`, "POST", { status: vars.to }),
    onMutate: async (vars: MoveVars) => {
      await qc.cancelQueries({ queryKey: ["leads-board"] });
      const snapshot = qc.getQueriesData<BoardPayload>({ queryKey: ["leads-board"] });
      // The card may live in any cached page of its source column.
      let carried: BoardCardData | null = null;
      for (const [, data] of snapshot) {
        const found = data?.columns.find((c) => c.status === vars.from)?.cards.find((x) => x.refId === vars.refId);
        if (found) {
          carried = found;
          break;
        }
      }
      qc.setQueriesData<BoardPayload>({ queryKey: ["leads-board"] }, (data) => (data ? applyMove(data, vars, carried) : data));
      return { snapshot };
    },
    onError: (error: Error, _vars, ctx) => {
      // Roll the whole board back to the pre-move snapshot, then say why (UXQ-03).
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
      toast.toast(error.message || "Couldn't move the lead.", "danger");
    },
    onSuccess: (_data, vars) => {
      toast.toast(`${vars.refId} → ${vars.to}`, "success");
    },
    onSettled: (_data, _err, vars) => {
      // The board and every other view of this lead re-read from the server.
      qc.invalidateQueries({ queryKey: ["leads-board"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead", vars.refId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
