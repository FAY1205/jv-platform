"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { statusDotClass } from "@/lib/status-pill";
import { BOARD_COLUMNS, BOARD_PAGE_SIZE, DRAG_CLICK_THRESHOLD_PX, boardAge } from "@/modules/leads/board";
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
// Drag is hand-rolled on native HTML5 DnD — no new dependency (KAN-07), the same
// house precedent as the map's pan/zoom and the RadioGroup.
//
// Perf (KAN-10): server-paginated per column (25); the optimistic cache update returns
// the SAME object for untouched columns, so a move re-renders only the two columns it
// touches (BoardColumnView is memoized on those references).

export interface BoardFilters {
  /** "" = all, a partner uuid, or the "unmatched" sentinel — mirrors the list. */
  partnerId: string;
  hot: boolean;
  /** TAG-03: selected tag ids (any-of) — carried over from the list's filter row. */
  tags: string[];
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

/** What a drag is carrying. Held in a ref (never state) so starting/ending a drag
 *  never re-renders the board — only the column being hovered lights up. */
interface DragPayload {
  refId: string;
  from: string;
}

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
  const filterKey = `${filters.partnerId}|${filters.hot}|${filters.tags.join(",")}`;
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

  const dragRef = React.useRef<DragPayload | null>(null);
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
      {/* Horizontal scroller: six fixed-width columns, never a squashed grid. */}
      <div className="flex items-start gap-3 overflow-x-auto rounded-2xl bg-surface-2 p-4" data-testid="leads-board">
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
            dragRef={dragRef}
            tagCtx={tagCtx}
            onOpen={onOpen}
            onMove={onMove}
            onLoadMore={onLoadMore}
          />
        ))}
      </div>
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
  dragRef: React.RefObject<DragPayload | null>;
  tagCtx: TagContext;
  onOpen: (refId: string) => void;
  onMove: (refId: string, from: string, to: string) => void;
  onLoadMore: (status: string) => void;
}

const BoardColumnView = React.memo(function BoardColumnView({
  status, data, loading, pagesLoaded, filters, filterKey, now, dragRef, tagCtx, onOpen, onMove, onLoadMore,
}: ColumnProps) {
  // Drop-target highlight is column-LOCAL state: hovering one column never re-renders
  // the other five (KAN-10).
  const [over, setOver] = React.useState(false);

  const accepts = () => {
    const d = dragRef.current;
    return Boolean(d) && d!.from !== status; // the source column is not a drop target
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!accepts()) return;
    e.preventDefault(); // required for the drop to fire at all
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setOver(true);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const d = dragRef.current;
    dragRef.current = null;
    if (d) onMove(d.refId, d.from, status);
  };

  const total = data?.total ?? 0;
  const cards = data?.cards ?? [];
  const loadedPages = Math.max(1, pagesLoaded);
  const hasMore = total > loadedPages * BOARD_PAGE_SIZE;
  const remaining = Math.min(BOARD_PAGE_SIZE, total - loadedPages * BOARD_PAGE_SIZE);

  return (
    <section
      aria-label={`${status} — ${total} ${total === 1 ? "lead" : "leads"}`}
      className="flex max-h-[34rem] w-60 shrink-0 flex-col rounded-lg border border-border bg-bg"
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-2.5">
        {/* Decorative dot — the status WORD is always present (PRN-14). */}
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(status)}`} aria-hidden="true" />
        <h2 className="text-step-0 font-bold uppercase tracking-wide text-text-2">{status}</h2>
        <span className="num ml-auto text-step-0 font-bold text-text-3">{total}</span>
      </header>

      <div
        data-testid={`board-column-${status}`}
        data-over={over ? "true" : undefined}
        onDragOver={onDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={[
          "flex min-h-[3.5rem] flex-col gap-2 overflow-y-auto rounded-b-lg px-2 pb-2.5 pt-1",
          over ? "outline outline-2 -outline-offset-4 outline-dashed outline-brand-line" : "",
        ].join(" ")}
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-1" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : cards.length === 0 && loadedPages === 1 ? (
          <EmptyState compact title="No leads" description={`Nothing is in ${status} yet.`} />
        ) : (
          cards.map((c) => (
            <BoardCardView key={c.refId} card={c} status={status} now={now} dragRef={dragRef} tagCtx={tagCtx} onOpen={onOpen} onMove={onMove} />
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
            dragRef={dragRef}
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
  page, status, filters, filterKey, now, dragRef, tagCtx, onOpen, onMove,
}: {
  page: number;
  status: string;
  filters: BoardFilters;
  filterKey: string;
  now: Date;
  dragRef: React.RefObject<DragPayload | null>;
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
        <BoardCardView key={c.refId} card={c} status={status} now={now} dragRef={dragRef} tagCtx={tagCtx} onOpen={onOpen} onMove={onMove} />
      ))}
    </>
  );
}

// ── one card ─────────────────────────────────────────────────────────────────

const BoardCardView = React.memo(function BoardCardView({
  card, status, now, dragRef, tagCtx, onOpen, onMove,
}: {
  card: BoardCardData;
  status: string;
  now: Date;
  dragRef: React.RefObject<DragPayload | null>;
  tagCtx: TagContext;
  onOpen: (refId: string) => void;
  onMove: (refId: string, from: string, to: string) => void;
}) {
  const [dragging, setDragging] = React.useState(false);
  // KAN-06: a press that MOVED is a drag, not a click — so a released drag never
  // also opens the dialog. Pointer coords live in a ref (no re-render per pointerdown).
  const pressRef = React.useRef<{ x: number; y: number } | null>(null);
  const age = boardAge(card.statusSince, now);
  const where = [card.city, card.state].filter(Boolean).join(", ");

  return (
    <article
      draggable
      data-testid={`board-card-${card.refId}`}
      data-dragging={dragging ? "true" : undefined}
      onDragStart={(e) => {
        dragRef.current = { refId: card.refId, from: status };
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", card.refId);
        }
        setDragging(true);
      }}
      onDragEnd={() => {
        dragRef.current = null;
        setDragging(false);
      }}
      onPointerDown={(e) => {
        pressRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        const start = pressRef.current;
        pressRef.current = null;
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_CLICK_THRESHOLD_PX) return;
        onOpen(card.refId);
      }}
      className={[
        "cursor-grab rounded-lg border border-border bg-surface px-2.5 py-2 shadow-xs transition-shadow",
        "hover:border-border-strong hover:shadow-sm active:cursor-grabbing",
        dragging ? "opacity-45" : "",
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

      {/* KAN-03: stale carries the ⚠ AND the amber tint AND the day count — never colour alone. */}
      <p className={`mt-1.5 text-step-0 ${age.stale ? "font-bold text-warn" : "text-text-3"}`}>
        {age.stale ? "⚠ " : ""}
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
