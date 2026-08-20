"use client";

import * as React from "react";
import { fmtDate } from "@/lib/dates";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { usePortalLeads } from "@/lib/portal-leads-client";
import { Button, EmptyState, FilterPill, Input, QueryErrorState, ScrollHintFade, Skeleton, useScrollHint, HotLeadMark } from "@/components";
import { statusPillClass } from "@/lib/status-pill";
import { PORTAL_STATUS_FILTERS, PORTAL_LEADS_DEFAULT_PAGE_SIZE, portalLeadsParams } from "@/modules/portal/leads-contract";

// WP-PW-3 Task 2: the mobile (< lg) Leads view.
// WP-UX-5 (audit portal-mobile 1–3): mobile no longer loses capability — the desktop's
// debounced search and status filter come along (same params, same endpoint), rendered
// phone-shaped: a full-width search input and a horizontally scrollable chip row. The
// card leads with the SELLER (the person a partner is about to call — it was the one
// datum the card omitted; info-design is first-class UX, owner 2026-08-16), address
// second, and carries a chevron so the tap-through is discoverable.

// C-41a: the row/page shapes come from the shared contract (they were re-declared here and
// had already drifted from the desktop's copy) — and so do the query key and url.

/**
 * `enabled` (C-41a): the view gate renders this list during the hydration window, BEFORE the
 * media query has resolved, because that is the markup the server sent. Fetching then would
 * be a wasted request on every desktop first paint, so the gate holds the query until the
 * viewport is genuinely known to be mobile.
 */
export function LeadsMobile({ onOpen, openRef = null, enabled = true }: { onOpen: (refId: string) => void; openRef?: string | null; enabled?: boolean }) {
  const [page, setPage] = React.useState(1);
  const [qInput, setQInput] = React.useState("");
  const qCommitted = useDebouncedValue(qInput.trim());
  const [statuses, setStatuses] = React.useState<string[]>([]);

  // The desktop view's filterKey idiom: a render-time compare resets `page` to 1
  // the moment search or status filters change.
  const filterKey = `${qCommitted}|${statuses.join(",")}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  if (filterKey !== resetKey) {
    setResetKey(filterKey);
    setPage(1);
  }

  const toggleStatus = (s: string) => setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  // C-53: the status chip strip is a horizontal scroller like a wide table — same affordance.
  const { ref: chipScrollerRef, more: moreChipsRight } = useScrollHint();

  // The canonical params: page 1 with no search and no status filter is BYTE-IDENTICAL to
  // what the desktop table and the dashboard preview ask for, so the three share one entry.
  const { data, isPending, error, refetch } = usePortalLeads(portalLeadsParams({ page, statuses, q: qCommitted }), { enabled });

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? PORTAL_LEADS_DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = qCommitted !== "" || statuses.length > 0;

  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-text md:hidden">Your leads</h1>
          {total > 0 && <p className="text-step-1 text-text-3">{total} total</p>}
        </div>
        <a href="/api/portal/leads/export" download>
          <Button variant="secondary" size="lg">
            Export
          </Button>
        </a>
      </div>

      {/* WP-UX-5: the desktop capabilities, phone-shaped. */}
      <div className="mb-2">
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onClear={() => setQInput("")}
          placeholder="Search seller, address, ZIP, phone, lead ID…"
          aria-label="Search your leads"
        />
      </div>
      {/* C-53: the chip strip scrolls past the viewport edge with no resting scrollbar on a
          phone, so the statuses beyond "Contacted" simply looked absent. Same fade the wide
          tables use (ScrollHint) — the negative margin moves to the WRAPPER so the fade lands
          on the true bleed edge, and `from-bg` because this strip sits on the page background,
          not inside a Card. */}
      <div className="relative -mx-4 mb-4">
        <div ref={chipScrollerRef} className="flex gap-1.5 overflow-x-auto px-4 pb-1">
          <FilterPill active={statuses.length === 0} onClick={() => setStatuses([])} className="shrink-0">
            All
          </FilterPill>
          {PORTAL_STATUS_FILTERS.map((s) => (
            <FilterPill key={s} active={statuses.includes(s)} onClick={() => toggleStatus(s)} className="shrink-0">
              {s}
            </FilterPill>
          ))}
        </div>
        {moreChipsRight && <ScrollHintFade from="bg" />}
      </div>

      {error ? (
        <QueryErrorState title="Couldn't load your leads" error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        // isPending (not isLoading): a HELD query is pending-but-not-fetching, and the
        // skeleton is what the hydration window should show.
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : leads.length === 0 ? (
        <EmptyState
          title="No leads found"
          description={hasFilters ? "Try widening your search or status filter." : "Leads assigned to you will appear here after the next upload."}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {leads.map((l) => (
              // N5-20: between 768px and `lg` this card list sits beside a NON-modal record
              // panel, so the card it is showing says so — `aria-current` for AT, the tint
              // alongside it (PRN-14). Below 768px the panel is a full-bleed sheet and the
              // mark is simply not on screen.
              <button
                key={l.refId}
                type="button"
                aria-current={l.refId === openRef ? "true" : undefined}
                // N5-30: focus the card BEFORE opening. SidePanel captures its return-focus
                // target by sampling `document.activeElement` on the open transition, and
                // whether a mouse-down on a button leaves it focused is browser-dependent
                // (Safari/Firefox historically do not on macOS). Without this, a click-opened
                // sheet on those browsers closes to focus on <body> — the reader is dumped at
                // the top of the page instead of back on the card they came from.
                onClick={(e) => { e.currentTarget.focus(); onOpen(l.refId); }}
                className={
                  // The background lives entirely in the branch: two `bg-*` utilities on one
                  // element resolve by stylesheet order, not by the order they are written here.
                  //
                  // N5-20 (SC 2.4.7): the focus indicator is a RING, not a border swap. The open
                  // card's resting border is already `border-brand-ink`, and focus returns to
                  // exactly that card when the sheet closes — a `focus-visible:border-brand-ink`
                  // would have been a no-op on the one card focus lands on most. The ring is
                  // additive and independent of the border (RowOpenButton's mechanism), and
                  // `ring-offset-bg` is explicit because these cards sit on the page background,
                  // not on a surface — Tailwind's un-set offset color is white, which is a white
                  // halo in dark mode.
                  "block w-full rounded-xl border p-4 text-left shadow-sm transition-[background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[.99] " +
                  (l.refId === openRef ? "border-brand-ink bg-brand-soft" : "border-border bg-surface hover:border-text-3 hover:bg-surface-2")
                }
              >
                <div className="flex items-center gap-2">
                  <span className="num text-step-1 text-text-3">{l.refId}</span>
                  {l.scoreGroup === "hot" && l.scoreTotal !== null && <HotLeadMark score={l.scoreTotal} />}
                  <span className={statusPillClass(l.status, "ml-auto")}>
                    {l.status}
                  </span>
                </div>
                {/* Seller leads the card — the person to call. */}
                <div className="mt-1.5 text-base font-semibold text-text">{l.sellerFirst} {l.sellerLast}</div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-text-2">{l.address}</span>
                  {/* Chevron: the tap-through affordance the flat card lacked. */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-text-3">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-step-1 text-text-3">
                  <span>
                    {l.city}, {l.state}
                  </span>
                  <span className="num">{l.zip}</span>
                  <span>· {fmtDate(l.receivedAt)}</span>
                </div>
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-step-1 text-text-3">
              <span>
                Page <span className="num">{page}</span> of <span className="num">{totalPages}</span> · <span className="num">{total}</span> leads
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="lg" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
