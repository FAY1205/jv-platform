import type { SavedViewFilters } from "@/modules/saved-views/schema";

// ─────────────────────────────────────────────────────────────────────────────
// N6-72 — the leads page's command channel.
//
// The Ctrl-K palette is mounted ONCE by the (admin) layout, deliberately OUTSIDE the leads
// route's component tree (so the hotkey works on pages that don't render AppShell). That means
// a palette action aimed at the leads list cannot call into it: there is no shared ancestor to
// hang a context or a store off, and inventing one just to reach across would put the leads
// page's private state on the whole app's shoulders.
//
// So the two talk over window events — the SAME shape lib/global-search.ts already uses for
// "open the palette" (the trigger lives inside AppShell, the overlay outside it, and neither
// imports the other). The palette dispatches; `LeadsBody` listens while it is mounted and
// routes each one through its existing one-way `applyView` channel. Off /leads the palette
// navigates to `/leads?view=<id>` instead — there is nothing listening, and firing into the
// void would be a button that does nothing.
//
// Deliberately NOT here: anything that writes. The palette is navigate-and-view only (owner
// decision, pinned by a test) — no event in this file can change a lead.
// ─────────────────────────────────────────────────────────────────────────────

/** Apply a saved view to the leads page (detail: the view's id, name and filter blob). */
export const LEADS_APPLY_VIEW_EVENT = "jv:leads-apply-view";
/** Reset the leads filter bar to the page's opening state. */
export const LEADS_CLEAR_FILTERS_EVENT = "jv:leads-clear-filters";
/** Open the leads table's Columns menu. */
export const LEADS_OPEN_COLUMNS_EVENT = "jv:leads-open-columns";

/** What rides on the apply event. The id/name are carried because the channel is one-way and
 *  a listener that wanted to name what it applied would otherwise have to look it up again;
 *  `filters` is the only field the leads page reads today. */
export interface LeadsApplyViewDetail {
  id: string;
  name: string;
  filters: SavedViewFilters;
}

/** No-ops outside the browser (the helpers are imported by client components that still
 *  render on the server for their first pass). */
function dispatch(event: Event): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(event);
}

export function requestLeadsApplyView(detail: LeadsApplyViewDetail): void {
  dispatch(new CustomEvent<LeadsApplyViewDetail>(LEADS_APPLY_VIEW_EVENT, { detail }));
}

export function requestLeadsClearFilters(): void {
  dispatch(new Event(LEADS_CLEAR_FILTERS_EVENT));
}

export function requestLeadsOpenColumns(): void {
  dispatch(new Event(LEADS_OPEN_COLUMNS_EVENT));
}

/** `/leads?view=<id>` — the off-page form of "apply this view". The page shell reads the param
 *  server-side and seeds the view once the roster has loaded (an unknown or foreign id simply
 *  matches nothing in that already-scoped roster and degrades to no-op). */
export function leadsViewHref(viewId: string): string {
  return `/leads?view=${encodeURIComponent(viewId)}`;
}
