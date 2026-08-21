"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { NAV_SECTIONS } from "@/lib/admin-nav";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  GLOBAL_SEARCH_OPEN_EVENT,
  highlightParts,
  isGlobalSearchHotkey,
  requestGlobalSearch,
} from "@/lib/global-search";
import {
  leadsViewHref,
  requestLeadsApplyView,
  requestLeadsClearFilters,
  requestLeadsOpenColumns,
} from "@/lib/leads-actions";
import { usePreferences } from "@/lib/preferences";
import { useSavedViews } from "@/lib/saved-views-client";
import { statusPillClass } from "@/lib/status-pill";
import {
  SEARCH_MIN_CHARS,
  isSearchable,
  normalizeSearchTerm,
  type SearchLeadRow,
  type SearchPartnerRow,
  type SearchResults,
} from "@/modules/search/schema";
import { Dialog } from "./Dialog";
import { EmptyState } from "./EmptyState";
import { HotLeadIcon } from "./HotLeadMark";
import { NavIcon, type NavIconName } from "./NavIcon";
import { QueryErrorState } from "./QueryErrorState";
import { Skeleton } from "./Skeleton";

// ─────────────────────────────────────────────────────────────────────────────
// Global search overlay (SRCH-02) — Ctrl/⌘-K from anywhere in the admin app.
//
// Two exports, mounted apart on purpose: the TRIGGER lives in the AppShell topbar,
// the OVERLAY is mounted once by the (admin) layout so the hotkey works on the few
// admin pages that don't render AppShell. They talk over one window event
// (lib/global-search), so neither imports the other.
//
// FEP/§6.17: the overlay owns its own query text, so keystrokes re-render THIS
// component only — never the page behind it — and the server call is debounced
// (SEARCH_DEBOUNCE_MS) before it is ever made.
// ─────────────────────────────────────────────────────────────────────────────

/** Owner-approved: 400ms between the last keystroke and the request (SRCH-02). */
export const SEARCH_DEBOUNCE_MS = 400;

/**
 * One row of the palette. Three of the five arms carry an `href` and are opened by
 * `router.push`; `nav` joined them for N6-71's "Go to" group. The `action` arm (N6-70) is the
 * new shape: it carries a `run` closure instead, and `go()` calls it.
 *
 * OWNER-PINNED (N6-72): no action in this palette MUTATES anything. Every `run` below either
 * dispatches one of the leads page's view/filter events or navigates — there is no write, no
 * `apiMutate`, no confirm-and-commit. A registry test asserts that (`global-search.test.tsx`),
 * so an action that grew a mutation would fail the suite rather than ship a one-keystroke,
 * un-undoable change to somebody's leads.
 */
type SearchItem =
  | { kind: "lead"; key: string; href: string; row: SearchLeadRow }
  | { kind: "partner"; key: string; href: string; row: SearchPartnerRow }
  | { kind: "more"; key: string; href: string; label: string }
  | { kind: "nav"; key: string; href: string; label: string; icon: NavIconName }
  | { kind: "action"; key: string; label: string; hint?: string; run: () => void };

/** A titled run of rows in the flat list. Headings ride the same `<ul>` so ONE cursor walks
 *  every group (the pattern the Leads/Partners groups already used, generalized). */
interface ItemGroup {
  key: string;
  label: string;
  /** Printed beside the heading when the server knows a fuller total than the rows shown. */
  total?: number;
  items: SearchItem[];
}

/** `/leads?open=<ref>` is the house deep-link that opens the admin lead DIALOG
 *  (the same one the status notification and AI citations use). */
function leadHref(refId: string): string {
  return `/leads?open=${encodeURIComponent(refId)}`;
}

/** UXF-2.2 (Scope-E audit §2.2): the overlay shows a capped preview but prints the FULL
 *  group total — "Leads · 42" over five rows was a dead end, with no way to reach the
 *  other 37. The Leads list seeds its filter from `?q=` (app/(admin)/leads/page.tsx), so
 *  a search hands off intact.
 *
 *  Only the Leads group gets this row: /partners has no query-seeded list, and inventing
 *  a destination would be worse than the honest omission. */
function overflowHref(term: string): string {
  return `/leads?q=${encodeURIComponent(term)}`;
}

/** Matched runs render as <mark> ELEMENTS around plain text children — the result text
 *  is data and never becomes markup (PRN-10). */
function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-[3px] bg-warn-soft px-0.5 text-text">
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/** The topbar affordance (SRCH-02). Full control on desktop; icon-only when narrow. */
export function GlobalSearchTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={requestGlobalSearch}
      aria-label="Search leads and partners"
      aria-keyshortcuts="Control+K Meta+K"
      className={cn(
        // 44px tap target, like the sibling chrome controls (F-66); tokens only (PRN-12).
        "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-step-1 text-text-3 transition-colors",
        // WP-UX-8 (audit): the search BAR box (border + fill) is desktop-only. Below md the
        // trigger is icon-only, so it drops the box to sit borderless beside the bell +
        // theme toggle — it was reading as "pressed" next to them.
        "hover:bg-surface-2 hover:text-text-2",
        "md:border md:border-border md:bg-surface-2 md:hover:border-border-strong",
        "active:scale-95 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <SearchIcon />
      <span className="hidden md:inline">Search…</span>
      <kbd className="num hidden rounded border border-border-strong bg-surface px-1 py-px text-step-0 font-semibold md:inline">
        Ctrl K
      </kbd>
    </button>
  );
}

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/**
 * The overlay itself. Mounted ONCE (the (admin) layout); opens on Ctrl/⌘-K or on the
 * topbar trigger's event. The focus TRAP and Esc-to-close come from the Dialog primitive
 * (Radix); return-focus-to-opener is hand-rolled here — see `openerRef` below.
 */
export function GlobalSearchOverlay() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listboxId = React.useId();
  // The committed (debounced) term is STATE, not a value derived from `q` — opening the
  // overlay has to reset it SYNCHRONOUSLY, or a reopen would show the previous search's
  // rows for one debounce window under an empty input (the same reason leads-view keeps
  // its own committed-state debounce rather than useDebouncedValue).
  const [committed, setCommitted] = React.useState("");
  React.useEffect(() => {
    if (q === committed) return;
    const t = setTimeout(() => setCommitted(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, committed]);
  // The term that is actually SENT — normalized with the endpoint's own rule, so the
  // echo check below compares like with like. Comparing the raw committed text against
  // the server's normalized echo would never match for a trailing space or an over-long
  // paste, leaving the overlay on a permanent skeleton (audit-tenancy F-3).
  const term = normalizeSearchTerm(committed);
  const ready = isSearchable(term);

  // Who to hand focus back to on close. Radix supplies the focus TRAP and Esc handling;
  // return-focus is hand-rolled because it restores to a Radix <Dialog.Trigger>, and this
  // overlay has none — it opens from a hotkey or a window event, so focus would otherwise
  // land on <body> (verified in jsdom, with and without the input's autoFocus). Recording
  // the opener ourselves keeps the keyboard where the user left it: the topbar trigger, or
  // whatever they were on when they hit Ctrl-K.
  const openerRef = React.useRef<HTMLElement | null>(null);

  // Global hotkey + the topbar trigger's event. One listener pair for the whole app.
  React.useEffect(() => {
    const openFresh = () => {
      // Re-entrant Ctrl-K (or a second trigger click) while the overlay is already open is
      // a NO-OP — wiping a half-typed term mid-query would be a hostile surprise.
      if (open) return;
      openerRef.current = document.activeElement as HTMLElement | null;
      setQ("");
      setCommitted("");
      setActive(0);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isGlobalSearchHotkey(e)) return;
      // A11Y-04 (pr-review, HIGH): never open OVER a layer that has the user's attention. The
      // palette became a place you can act from in N6-70, so layering it on top of an open
      // confirm — a bulk assign's "Assign 641 leads", a Save/Update/Delete dialog — would let
      // "Clear filters" reset the page state behind a modal that is still asking a question.
      // Same rule (and same closest() shape) as the lead panel's ↑/↓ binding: yield to a key
      // another layer has already claimed, and to the surfaces that own their own keyboard.
      //
      // Plain inputs are deliberately NOT excluded, unlike that binding: this is a modified
      // chord, so it can never be mistaken for typing, and Ctrl-K out of the leads search box
      // is a path operators actually use. An input INSIDE a dialog is already covered below.
      //
      // The re-entrant case is checked FIRST: the palette is itself a dialog, and it must keep
      // swallowing its own hotkey (the browser's address bar must not win) rather than fall
      // into the guard below.
      if (open) {
        e.preventDefault();
        return;
      }
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]')) return;
      e.preventDefault(); // the browser's own Ctrl-K (address bar) must not win
      openFresh();
    };
    const onRequest = () => openFresh();
    window.addEventListener("keydown", onKey);
    window.addEventListener(GLOBAL_SEARCH_OPEN_EVENT, onRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(GLOBAL_SEARCH_OPEN_EVENT, onRequest);
    };
  }, [open]);

  const query = useQuery({
    queryKey: ["global-search", term],
    queryFn: () => apiGet<SearchResults>(`/api/search?q=${encodeURIComponent(term)}`),
    enabled: open && ready,
    staleTime: 30_000,
  });

  // Only trust a payload that belongs to the CURRENT query text — while a new term is
  // in flight, the previous term's rows must not stay arrow-selectable underneath it.
  const data = query.data?.q === term ? query.data : undefined;

  // ── N6-71: the palette's actions ───────────────────────────────────────────────────────
  // The saved-view roster is fetched when the palette OPENS, not on every admin page load.
  // `views.own` — every seat has it, so there is nothing to gate. A failed read leaves the
  // search half working and says so in an inline retry row (below) rather than silently
  // showing an empty Actions group, which reads identically to "you have no views".
  const viewsQ = useSavedViews(open);
  const savedViews = viewsQ.data?.views;

  // Which page is underneath. The two page-scoped actions exist ONLY on /leads, where a
  // `LeadsBody` is mounted and listening (N6-72) — elsewhere they would fire into the void, and
  // a row that silently does nothing is worse than a row that isn't there. `Apply view` still
  // works everywhere: off /leads it navigates instead of dispatching.
  const pathname = usePathname() ?? "";
  const onLeads = pathname === "/leads";
  // …and the same rule one level down (audit-ux-flows): the board has no Columns menu, so in
  // board mode that row would be a dead click. The preference store is the same one the leads
  // page reads, so the palette and the page can never disagree about which view is up.
  // "Clear filters" stays unconditional — the board honours the whole filter set.
  const leadsListMode = usePreferences().leadsView === "list";

  const actionItems: SearchItem[] = React.useMemo(() => {
    const out: SearchItem[] = [];
    for (const v of savedViews ?? []) {
      out.push({
        kind: "action",
        key: `view:${v.id}`,
        label: `Apply view: ${v.name}`,
        run: () =>
          onLeads
            ? requestLeadsApplyView({ id: v.id, name: v.name, filters: v.filters })
            : router.push(leadsViewHref(v.id)),
      });
    }
    if (onLeads) {
      out.push({ kind: "action", key: "leads:clear", label: "Clear filters", hint: "this page", run: requestLeadsClearFilters });
      if (leadsListMode) {
        out.push({ kind: "action", key: "leads:columns", label: "Open Columns", hint: "this page", run: requestLeadsOpenColumns });
      }
    }
    return out;
  }, [savedViews, onLeads, leadsListMode, router]);

  /** N6-71: the "Go to" destinations — the SHELL's own nav constant, not a second copy that
   *  would drift the first time a page is added. Not capability-filtered, exactly like the
   *  sidebar it mirrors. */
  const navItems: SearchItem[] = React.useMemo(
    () =>
      NAV_SECTIONS.flatMap((section) =>
        section.items.map((item): SearchItem => ({ kind: "nav", key: `nav:${item.href}`, href: item.href, label: item.label, icon: item.icon })),
      ),
    [],
  );

  // Actions filter on the LIVE input text, never the debounced/committed term: they are
  // answered locally, and making them wait out the server debounce would read as a stall.
  const filterText = q.trim().toLowerCase();
  const labelMatch = React.useCallback(
    (label: string) => filterText === "" || label.toLowerCase().includes(filterText),
    [filterText],
  );

  /**
   * The whole list, grouped. Matching Actions sit ABOVE the search groups (N6-71) — they are
   * the thing the operator asked for by name, where a result is a thing they asked for by
   * content — and "Go to" closes the list. Below the search minimum the two local groups are
   * all there is, which is what turns the old dead "type 2 characters" state into a menu.
   */
  const groups: ItemGroup[] = React.useMemo(() => {
    const out: ItemGroup[] = [];
    const actions = actionItems.filter((it) => it.kind === "action" && labelMatch(it.label));
    if (actions.length > 0) out.push({ key: "actions", label: "Actions", items: actions });

    if (data) {
      const leads = data.leads.rows.map((row): SearchItem => ({ kind: "lead", key: `lead:${row.refId}`, href: leadHref(row.refId), row }));
      // UXF-2.2: the "see the rest" row closes the Leads group — a real listbox option, so
      // ↑↓ and ↵ reach it exactly like a result (SC 2.1.1), not a mouse-only afterthought.
      const more: SearchItem[] =
        data.leads.total > data.leads.rows.length
          ? [{ kind: "more", key: "more:leads", href: overflowHref(data.q), label: `View all ${data.leads.total} in Leads` }]
          : [];
      if (leads.length > 0) out.push({ key: "leads", label: "Leads", total: data.leads.total, items: [...leads, ...more] });
      const partners = data.partners.rows.map((row): SearchItem => ({ kind: "partner", key: `partner:${row.id}`, href: `/partners/${row.id}`, row }));
      if (partners.length > 0) out.push({ key: "partners", label: "Partners", total: data.partners.total, items: partners });
    }

    const nav = navItems.filter((it) => it.kind === "nav" && labelMatch(it.label));
    if (nav.length > 0) out.push({ key: "nav", label: "Go to", items: nav });
    return out;
  }, [data, actionItems, navItems, labelMatch]);

  const items: SearchItem[] = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);
  /** Each group's heading, keyed by the flat index of its first row — so one `<ul>` carries
   *  every group and one cursor walks all of them. */
  const headings = React.useMemo(() => {
    const at = new Map<number, ItemGroup>();
    let i = 0;
    for (const g of groups) {
      at.set(i, g);
      i += g.items.length;
    }
    return at;
  }, [groups]);

  /** How many SERVER results are on screen — the empty state speaks for the search only, so
   *  "No matches" still appears beside an action row that happened to match the same text. */
  const resultCount = data ? data.leads.rows.length + data.partners.rows.length : 0;

  // Reset the cursor when the list changes — adjusting state during render (the
  // React-recommended alternative to an effect; the `seeded` pattern used elsewhere). Opening is
  // covered separately by `openFresh`, which zeroes it synchronously.
  //
  // The key names every input that can RESHAPE the list, not just the two texts (pr-review +
  // audit-ux-flows, HIGH): the saved-view roster resolves after the palette opens and PREPENDS
  // "Apply view" rows above everything, and search results splice whole groups in. Either one
  // shifts rows under a cursor the operator has already moved — and ↵ would then fire the row
  // that slid into place. Clamping alone can't see that: the index stays valid, it just means
  // something else now.
  const cursorKey = `${filterText}|${term}|${savedViews ? savedViews.length : "pending"}|${data ? "results" : "none"}`;
  const [syncedKey, setSyncedKey] = React.useState(cursorKey);
  if (syncedKey !== cursorKey) {
    setSyncedKey(cursorKey);
    if (active !== 0) setActive(0);
  }
  const cursor = items.length === 0 ? -1 : Math.min(active, items.length - 1);

  /** Close + restore focus to the opener. Runs after Radix's own close-focus handling. */
  const close = React.useCallback(() => {
    setOpen(false);
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener) return;
    setTimeout(() => {
      if (opener.isConnected) opener.focus();
    }, 0);
  }, []);

  /** N6-70: ↵ (or a click) either navigates or RUNS. The palette closes FIRST either way — an
   *  action that opens a menu on the page behind it must not be racing a scrim on its way out. */
  const go = (item: SearchItem) => {
    close();
    if (item.kind === "action") item.run();
    else router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      // Wrapping (SRCH-02): past the last row lands on the first, and vice-versa.
      setActive((a) => {
        const from = Math.min(a, items.length - 1);
        return (from + delta + items.length) % items.length;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[cursor];
      if (item) go(item);
    }
  };

  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  return (
    <Dialog open={open} onClose={close} ariaLabel="Search leads and partners" size="lg" bare>
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3 text-text-3">
        <SearchIcon size={16} />
        {/* ARIA 1.2 combobox pattern (same as the Combobox primitive): the input keeps
            focus and drives a listbox by aria-activedescendant. */}
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={cursor >= 0 ? optionId(cursor) : undefined}
          aria-label="Search name, phone, address, or reference"
          placeholder="Search name, phone, address, or ref…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          className="flex-1 border-0 bg-transparent text-sm text-text outline-none placeholder:text-text-3"
        />
        {/* WP-UX-8 (audit G-2): the esc hint lives once, in the footer's hint set (↑↓ / ↵ / esc) —
            the duplicate chip in the input was redundant. */}
      </div>

      <div className="max-h-[52vh] overflow-auto px-2 py-2">
        {/* N6-71 (audit-ux-flows): a failed roster read used to be indistinguishable from
            "you have no saved views" — and off /leads this palette is the ONLY place a view can
            be applied, so silence there is a dead end with no way back. Reported inline, with a
            retry, in the same shape the views menu uses. Not a listbox option: it is not a
            destination, and the arrow keys must keep walking rows that go somewhere. */}
        {viewsQ.isError && (
          <div className="mx-1 mb-1 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-step-1 text-text-3">
            <span className="flex-1">Couldn&apos;t load your saved views.</span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()} // keep focus in the input
              onClick={() => void viewsQ.refetch()}
              className="shrink-0 rounded text-step-1 font-semibold text-brand-ink underline-offset-2 hover:underline focus-visible:underline"
            >
              Retry
            </button>
          </div>
        )}
        {items.length > 0 && (
          <ul role="listbox" id={listboxId} aria-label="Results and actions" className="space-y-0.5">
            {items.map((item, i) => {
              // Group headings ride the same flat list, so one cursor walks every group.
              const heading = headings.get(i);
              return (
                <React.Fragment key={item.key}>
                  {heading && <GroupHeading label={heading.label} total={heading.total} />}
                  <li
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === cursor}
                    onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
                      i === cursor ? "bg-brand-soft text-text" : "text-text hover:bg-surface-2",
                      item.kind === "more" && "font-semibold text-brand-ink",
                    )}
                  >
                    {item.kind === "lead" ? (
                      <LeadRow row={item.row} q={term} />
                    ) : item.kind === "partner" ? (
                      <PartnerRow row={item.row} q={term} />
                    ) : item.kind === "nav" ? (
                      <NavRow label={item.label} icon={item.icon} />
                    ) : item.kind === "action" ? (
                      <ActionRow label={item.label} hint={item.hint} />
                    ) : (
                      <MoreRow label={item.label} />
                    )}
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
        )}

        {/* The SEARCH half's three async states. They sit under the list rather than replacing
            it, because the local Actions / Go to rows are answerable with no server at all —
            a skeleton over them would hide rows that are already usable. */}
        {ready ? (
          query.isError ? (
            <QueryErrorState compact error={query.error} title="Couldn't run this search" onRetry={() => void query.refetch()} />
          ) : !data ? (
            <div className="space-y-2 px-2 py-2" aria-busy="true">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : resultCount === 0 ? (
            <EmptyState compact title="No matches" description="Try a name, a phone number, an address, or a reference ID." />
          ) : null
        ) : items.length === 0 ? (
          // Below the minimum AND nothing local matched: say what would help. With rows on
          // screen this copy would be contradicted by the list right above it (N6-71).
          <p className="px-3 py-6 text-center text-step-1 text-text-3">
            Type at least {SEARCH_MIN_CHARS} characters to search leads and partners.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-step-0 text-text-3">
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        {/* N6-74: ↵ no longer only opens — on an action row it runs it, here and in the docs. */}
        <span>↵ run</span>
        <span>esc close</span>
        <span className="ml-auto">Results respect your workspace scope</span>
      </div>
    </Dialog>
  );
}

function GroupHeading({ label, total }: { label: string; total?: number }) {
  return (
    <li role="presentation" className="px-3 pb-1 pt-2 text-step-0 font-semibold uppercase tracking-[.08em] text-text-3">
      {label}
      {/* The local groups (Actions / Go to) have no server-side total to print, and a count of
          the rows already visible would be noise. */}
      {total !== undefined && (
        <>
          {" · "}
          <span className="num">{total}</span>
        </>
      )}
    </li>
  );
}

/** N6-71: a "Go to" destination. Same glyph as the sidebar rail (one drawing — NavIcon), so
 *  the palette's Leads row and the rail's Leads row are visibly the same place. */
function NavRow({ label, icon }: { label: string; icon: NavIconName }) {
  return (
    <>
      <NavIcon name={icon} className="h-4 w-4 shrink-0 text-text-3" />
      <span className="flex-1">{label}</span>
      <span aria-hidden="true" className="shrink-0 text-text-3">
        →
      </span>
    </>
  );
}

/** N6-70: an action row. The hint says WHERE it acts ("this page") — the same row on another
 *  page would mean something else, so the scope is part of the label, not folklore. */
function ActionRow({ label, hint }: { label: string; hint?: string }) {
  return (
    <>
      {/* An SVG rather than a text glyph: decorative marks that live in the text stream end up
          in copied text and in every string comparison over the row. */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-text-3">
        <path d="M20 11a8 8 0 0 0-13.7-5.2L3.5 8.5M20 5v4h-4" />
        <path d="M4 13a8 8 0 0 0 13.7 5.2l2.8-2.7M4 19v-4h4" />
      </svg>
      {/* The separator is part of the TEXT, not a border: this row's accessible name is its
          text content, and "Open Columnsthis page" is what a screen reader read out before it
          (pr-review). */}
      <span className="flex-1">{label}</span>
      {hint && <span className="shrink-0 text-step-0 text-text-3">· {hint}</span>}
    </>
  );
}

/** UXF-2.2: the group's overflow row. Plain text plus the same → the attention pills use;
 *  the arrow is decorative, the sentence already says where it goes. */
function MoreRow({ label }: { label: string }) {
  return (
    <>
      <span className="flex-1">{label}</span>
      <span aria-hidden="true" className="shrink-0">
        →
      </span>
    </>
  );
}

function LeadRow({ row, q }: { row: SearchLeadRow; q: string }) {
  const place = [row.city, row.state].filter(Boolean).join(", ");
  return (
    <>
      <span className="num shrink-0 text-xs font-semibold text-brand-ink">
        <Highlight text={row.refId} query={q} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">
          <Highlight text={row.seller} query={q} />
        </span>
        {row.address && (
          <span className="text-text-2">
            {" — "}
            <Highlight text={row.address} query={q} />
          </span>
        )}
        {place && (
          <span className="text-text-3">
            {", "}
            <Highlight text={place} query={q} />
          </span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {/* SCR: the Hot smart tag, in the same target-icon treatment as the list mark.
            Text accompanies the color and the icon (PRN-14). */}
        {row.hot && row.scoreTotal !== null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-step-0 font-semibold text-warn">
            <HotLeadIcon size={10} />
            Hot · <span className="num">{row.scoreTotal}</span>
          </span>
        )}
        <span className={statusPillClass(row.status, "text-step-0")}>{row.status}</span>
      </span>
    </>
  );
}

function PartnerRow({ row, q }: { row: SearchPartnerRow; q: string }) {
  return (
    <>
      {/* PRN-14: the swatch is decorative — the partner NAME and reference ID are always
          present beside it, never color alone. */}
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: row.color }} />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">
          <Highlight text={row.name} query={q} />
        </span>
        {/* The email is shown because it is one of the matched fields — a hit on
            "ops@…" with nothing visible to explain it reads as a bug. */}
        {row.email && (
          <span className="text-text-3">
            {" · "}
            <Highlight text={row.email} query={q} />
          </span>
        )}
      </span>
      <span className="num ml-auto shrink-0 text-step-0 text-text-3">
        <Highlight text={row.refId} query={q} />
      </span>
    </>
  );
}
