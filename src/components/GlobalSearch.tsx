"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  GLOBAL_SEARCH_OPEN_EVENT,
  highlightParts,
  isGlobalSearchHotkey,
  requestGlobalSearch,
} from "@/lib/global-search";
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

type SearchItem =
  | { kind: "lead"; key: string; href: string; row: SearchLeadRow }
  | { kind: "partner"; key: string; href: string; row: SearchPartnerRow };

/** `/leads?open=<ref>` is the house deep-link that opens the admin lead DIALOG
 *  (the same one the status notification and AI citations use). */
function leadHref(refId: string): string {
  return `/leads?open=${encodeURIComponent(refId)}`;
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
        "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md border border-border",
        "bg-surface-2 px-3 text-step-1 text-text-3 transition-colors",
        "hover:border-border-strong hover:text-text-2 focus-visible:border-border",
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

  const items: SearchItem[] = React.useMemo(() => {
    if (!data) return [];
    return [
      ...data.leads.rows.map((row): SearchItem => ({ kind: "lead", key: `lead:${row.refId}`, href: leadHref(row.refId), row })),
      ...data.partners.rows.map((row): SearchItem => ({ kind: "partner", key: `partner:${row.id}`, href: `/partners/${row.id}`, row })),
    ];
  }, [data]);

  // Reset the cursor when the result set changes — adjusting state during render (the
  // React-recommended alternative to an effect; the `seeded` pattern used elsewhere).
  const [syncedKey, setSyncedKey] = React.useState(term);
  if (syncedKey !== term) {
    setSyncedKey(term);
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

  const go = (item: SearchItem) => {
    close();
    router.push(item.href);
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
        <kbd className="num rounded border border-border-strong bg-surface px-1 py-px text-step-0 font-semibold">esc</kbd>
      </div>

      <div className="max-h-[52vh] overflow-auto px-2 py-2">
        {!ready ? (
          <p className="px-3 py-6 text-center text-step-1 text-text-3">
            Type at least {SEARCH_MIN_CHARS} characters to search leads and partners.
          </p>
        ) : query.isError ? (
          <QueryErrorState compact error={query.error} title="Couldn't run this search" onRetry={() => void query.refetch()} />
        ) : !data ? (
          <div className="space-y-2 px-2 py-2" aria-busy="true">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState compact title="No matches" description="Try a name, a phone number, an address, or a reference ID." />
        ) : (
          <ul role="listbox" id={listboxId} aria-label="Search results" className="space-y-0.5">
            {items.map((item, i) => (
              <React.Fragment key={item.key}>
                {/* Group headings ride the same flat list, so one cursor walks both groups. */}
                {i === 0 && item.kind === "lead" && <GroupHeading label="Leads" total={data.leads.total} />}
                {i === data.leads.rows.length && <GroupHeading label="Partners" total={data.partners.total} />}
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
                  )}
                >
                  {item.kind === "lead" ? <LeadRow row={item.row} q={term} /> : <PartnerRow row={item.row} q={term} />}
                </li>
              </React.Fragment>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-step-0 text-text-3">
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>esc close</span>
        <span className="ml-auto">Results respect your workspace scope</span>
      </div>
    </Dialog>
  );
}

function GroupHeading({ label, total }: { label: string; total: number }) {
  return (
    <li role="presentation" className="px-3 pb-1 pt-2 text-step-0 font-semibold uppercase tracking-[.08em] text-text-3">
      {label} · <span className="num">{total}</span>
    </li>
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
