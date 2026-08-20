"use client";

import * as React from "react";
import { ARROW_BUTTON_CLASS, Spinner } from "@/components";
import type { LeadsPage } from "./leads-view";

// N5-04 (C-59) — prev/next triage from inside the lead panel. The working set is the leads
// list's CURRENT filtered + sorted result, so "3 of 686" means the third of the 686 rows the
// table is showing, not the third lead in the workspace. M is the query's own `total`; N is
// derived from the page the payload reports (never the requested page — the list keeps the
// previous page's data while the next is in flight).
//
// The whole thing is derived per render from the list query. Nothing about the position is
// held in state, so it cannot drift from the table behind the panel; the ONE piece of state
// is the in-flight page jump, which exists only to know which row to open when data lands.

export interface LeadNav {
  /** 1-based position of the open lead in the working set. */
  index: number;
  /** The working set's size — the leads query's `total`. */
  total: number;
  canPrev: boolean;
  canNext: boolean;
  /** A neighbor page is in flight: the arrows are held so a second press can't double-fire. */
  pending: boolean;
  prev: () => void;
  next: () => void;
}

/**
 * Builds the panel's nav from the list query's current page. Returns null when there is
 * nothing honest to show — no data yet, or the open ref is not in the working set (N5-05: a
 * deep link into a lead the filters exclude gets NO pager rather than a lying "1 of 686").
 *
 * Call it from the component that OWNS `openRef` and the list page: it resolves a landed page
 * jump during render by calling `onOpen`/`onPageChange`, which is only legal for the rendering
 * component's own state.
 */
export function useLeadNav({
  data,
  isError,
  openRef,
  onOpen,
  onPageChange,
}: {
  data: LeadsPage | undefined;
  isError: boolean;
  openRef: string | null;
  onOpen: (refId: string) => void;
  onPageChange: (page: number) => void;
}): LeadNav | null {
  // The page we asked for, and which end of it to open when it arrives.
  const [jump, setJump] = React.useState<{ page: number; edge: "first" | "last" } | null>(null);

  // Resolving the jump DURING RENDER, not in an effect: both setters here belong to the caller
  // (the leads page owns `openRef` and calls this hook), so this is the "adjust state while
  // rendering" idiom used across this page — React discards the in-flight render and re-runs
  // with the new row already open. An effect would land after paint, blinking the pager out of
  // the header for a frame, and would trip the cascading-render lint.
  if (jump) {
    if (isError) {
      // A failed neighbor fetch must not leave the arrows held forever.
      setJump(null);
    } else if (data && data.page === jump.page) {
      // The list keeps the PREVIOUS page's rows while the next is in flight (keepPreviousData),
      // so the payload's own `page` is what says the neighbor has actually landed.
      const row = jump.edge === "first" ? data.leads[0] : data.leads[data.leads.length - 1];
      setJump(null);
      if (row) onOpen(row.refId);
    }
  }

  const idx = data && openRef ? data.leads.findIndex((r) => r.refId === openRef) : -1;
  if (!data || idx < 0) return null;

  const index = (data.page - 1) * data.pageSize + idx + 1;
  const pending = jump !== null;
  const step = (dir: -1 | 1) => {
    if (pending) return;
    const neighbor = data.leads[idx + dir];
    if (neighbor) { onOpen(neighbor.refId); return; }
    // Off the end of this table page but still inside the working set: advance the LIST and
    // open the adjacent row once its page lands.
    const page = data.page + dir;
    setJump({ page, edge: dir === 1 ? "first" : "last" });
    onPageChange(page);
  };

  return {
    index,
    total: data.total,
    canPrev: index > 1,
    canNext: index < data.total,
    pending,
    prev: () => { if (index > 1) step(-1); },
    next: () => { if (index < data.total) step(1); },
  };
}

/** `‹ N of M ›` in the panel header. Ends of the list are a data boundary, so the arrow is
 *  really `disabled` — not aria-disabled, which is reserved for permission misses. */
export function LeadPager({ nav }: { nav: LeadNav }) {
  return (
    <div role="group" aria-label="Lead navigation" className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={ARROW_BUTTON_CLASS}
        aria-label="Previous lead"
        disabled={!nav.canPrev || nav.pending}
        onClick={nav.prev}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span className="num px-0.5 text-step-1 tabular-nums text-text-3">
        {nav.index.toLocaleString()} of {nav.total.toLocaleString()}
      </span>
      {/* A fixed slot so the pending spinner cannot shift the header's layout. */}
      <span className="grid w-3.5 place-items-center text-text-3" aria-hidden="true">
        {nav.pending && <Spinner size={12} />}
      </span>
      {nav.pending && <span className="sr-only" role="status">Loading the next lead…</span>}
      <button
        type="button"
        className={ARROW_BUTTON_CLASS}
        aria-label="Next lead"
        disabled={!nav.canNext || nav.pending}
        onClick={nav.next}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
