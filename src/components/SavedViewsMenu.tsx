"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { savedViewKey, SAVED_VIEW_NAME_MAX, type SavedViewFilters } from "@/modules/saved-views/schema";
import { useSavedViews, useSavedViewMutations, type SavedViewRow } from "@/lib/saved-views-client";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "./DropdownMenu";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { Skeleton } from "./Skeleton";
import { useToast } from "./Toast";

// WP-SV-1 (SV-03/SV-04) — the leads-page views dropdown (mockup screen 1, top-left).
//
// What it owns: which view is APPLIED (an id — a UI selection), and the drafts inside its two
// dialogs. Everything else is read from the query cache (§6.17). Applying REPLACES the whole
// filter state including the list/board mode (SV-04) — the parent hands the replacement
// straight into its filter bar, which is why this component takes an `onApply` callback rather
// than reaching for filter state itself.
//
// The "modified" indicator is a COMPARISON, not a heuristic: `savedViewKey` canonicalizes both
// sides (arrays sorted, one shape), so it is true exactly when the current filters differ from
// what the applied view stored. Subsequent edits never auto-save back — re-saving is explicit,
// which is what the indicator invites.
//
// NO live counts, deliberately (recorded decision at sign-off): a count in the menu would
// either cost a query per view on every open or be stale the moment a lead arrives, and a
// wrong number beside a filter is worse than no number. The mockup's counts are the one thing
// intentionally dropped from it.

export interface SavedViewsMenuProps {
  /** The leads page's CURRENT filter state, including the list/board mode. */
  filters: SavedViewFilters;
  /** Replace the whole filter state with a saved view's (SV-04). */
  onApply: (filters: SavedViewFilters) => void;
  className?: string;
}

const StarIcon = ({ className }: { className?: string }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z" />
  </svg>
);

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

/** Case-insensitive name lookup — the same rule the unique index enforces server-side, so the
 *  overwrite prompt appears BEFORE a request that would 409 (the 409 stays as the race guard). */
function findByName(views: readonly SavedViewRow[], name: string): SavedViewRow | undefined {
  const needle = name.trim().toLowerCase();
  return views.find((v) => v.name.toLowerCase() === needle);
}

export function SavedViewsMenu({ filters, onApply, className }: SavedViewsMenuProps) {
  const { toast } = useToast();
  const viewsQ = useSavedViews();
  const views = React.useMemo(() => viewsQ.data?.views ?? [], [viewsQ.data]);
  const { create, update, remove, busy } = useSavedViewMutations();

  const [menuOpen, setMenuOpen] = React.useState(false);
  /**
   * The APPLIED view — a snapshot of what the operator chose (or just saved), held as UI state
   * rather than looked up in the roster on every render. Not a §6.17 violation: "which view am
   * I looking at" is a selection, the same kind of thing as which row is expanded. Deriving it
   * from the cache instead would break the moment a save succeeds — for the tick between the
   * POST resolving and the refetch landing, the roster does not yet contain the new view, and a
   * derived name would blink away right after the operator named it.
   */
  const [active, setActive] = React.useState<{ id: string; name: string; filters: SavedViewFilters } | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  /** The existing view a save would replace — set once the operator has been asked. */
  const [overwriting, setOverwriting] = React.useState<SavedViewRow | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<SavedViewRow | null>(null);

  const modified = active !== null && savedViewKey(filters) !== savedViewKey(active.filters);

  const apply = (v: SavedViewRow) => {
    setActive({ id: v.id, name: v.name, filters: v.filters });
    onApply(v.filters); // SV-04: REPLACES the whole state, view mode included
  };

  const openSave = () => {
    // Pre-fill with the applied view's name: the common gesture after tweaking a view is to
    // re-save it, and typing the name again just to be asked "overwrite?" is busywork.
    setDraftName(active?.name ?? "");
    setOverwriting(null);
    setSaveError(null);
    setSaveOpen(true);
  };

  const closeSave = () => {
    if (create.isPending || update.isPending) return;
    setSaveOpen(false);
  };

  const submitSave = () => {
    const name = draftName.trim();
    if (!name) return;
    const existing = overwriting ?? findByName(views, name);
    if (existing && !overwriting) {
      // First press on a name that is taken: ask, don't clobber (SV-03).
      setOverwriting(existing);
      setSaveError(null);
      return;
    }
    if (existing) {
      update.mutate(
        { id: existing.id, filters },
        {
          onSuccess: () => {
            setActive({ id: existing.id, name: existing.name, filters });
            setSaveOpen(false);
            toast("View saved.", "success");
          },
          onError: (e) => setSaveError(e.message || "Couldn't save the view."),
        },
      );
      return;
    }
    create.mutate(
      { name, filters },
      {
        onSuccess: (d) => { setActive({ id: d.id, name, filters }); setSaveOpen(false); toast("View saved.", "success"); },
        onError: (e) => {
          // The DB is the only duplicate authority: a name created in another tab since this
          // menu was read still 409s. Refetch so the retry can resolve that name to an id and
          // offer the overwrite, rather than dead-ending. Branch on the server's `code` — the
          // stable contract — never on the message text (pr-review F-1).
          setSaveError(e.message || "Couldn't save the view.");
          if (e.code === "duplicate_view") void viewsQ.refetch();
        },
      },
    );
  };

  const submitDelete = () => {
    if (!confirmDelete) return;
    remove.mutate(confirmDelete.id, {
      onSuccess: () => {
        // The filters stay exactly as they are — they just stop carrying a name.
        if (active?.id === confirmDelete.id) setActive(null);
        setConfirmDelete(null);
        toast("View deleted.", "success");
      },
      onError: (e) => toast(e.message || "Couldn't delete the view.", "danger"),
    });
  };

  const saving = create.isPending || update.isPending;

  return (
    <div className={cn("flex items-center", className)}>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={active ? `Saved views — ${active.name}${modified ? ", modified" : ""}` : "Saved views"}
            className={cn(
              // States (DSN-03): focus-visible is deliberately NOT opted out of — the global
              // brand-ink outline (globals.css @layer base) is this control's focus treatment,
              // exactly as on IconButton; the border shift below is the additional hint.
              "inline-flex max-w-[16rem] items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5",
              "text-xs font-semibold text-text-2 transition-colors",
              "hover:bg-surface-2 hover:text-text focus-visible:border-border-strong",
              "active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <StarIcon className={active ? "text-warn" : "text-text-3"} />
            <span className="truncate">{active ? active.name : "Views"}</span>
            {modified && (
              // PRN-14: the divergence is stated in words, never by color alone.
              <span className="shrink-0 rounded bg-surface-3 px-1 py-px text-step-0 font-semibold text-text-3">
                Modified
              </span>
            )}
            <ChevronIcon />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>

          {viewsQ.isPending ? (
            <div className="flex flex-col gap-1.5 p-2" aria-busy="true">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : viewsQ.error ? (
            <div className="px-2 py-1.5">
              <p className="text-xs text-text-3">Couldn&apos;t load your views.</p>
              <button
                type="button"
                onClick={() => void viewsQ.refetch()}
                className="mt-1 rounded text-xs font-semibold text-brand-ink underline-offset-2 hover:underline"
              >
                Retry
              </button>
            </div>
          ) : views.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-text-3">No saved views yet.</p>
          ) : (
            views.map((v) => (
              <div key={v.id} className="flex items-center gap-0.5">
                <DropdownMenuItem
                  className={cn("min-w-0 flex-1", v.id === active?.id && "bg-brand-soft font-semibold text-brand-ink")}
                  onSelect={() => apply(v)}
                >
                  <StarIcon className={v.id === active?.id ? "text-warn" : "text-text-3"} />
                  <span className="truncate">{v.name}</span>
                </DropdownMenuItem>
                {/* A second menu ITEM, not a nested button: roving focus reaches it with the
                    arrow keys, and selecting it closes the menu so the confirmation can own
                    the screen. */}
                <DropdownMenuItem
                  destructive
                  aria-label={`Delete view ${v.name}`}
                  className="shrink-0 px-1.5"
                  onSelect={() => setConfirmDelete(v)}
                >
                  <TrashIcon />
                </DropdownMenuItem>
              </div>
            ))
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem className="font-semibold text-brand-ink" onSelect={openSave}>
            ＋ Save current filters…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* SV-03: the name prompt. Saving under an EXISTING name asks before it overwrites — the
          same case-insensitive rule the unique index enforces, checked here first so the
          question is asked instead of a 409 being reported. */}
      <Dialog
        open={saveOpen}
        onClose={closeSave}
        title="Save current filters"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeSave} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitSave} disabled={!draftName.trim() || busy} loading={saving}>
              {overwriting ? "Overwrite view" : "Save view"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <Input
            autoFocus
            value={draftName}
            maxLength={SAVED_VIEW_NAME_MAX}
            aria-label="View name"
            placeholder="e.g. Hot in AZ"
            disabled={saving}
            onChange={(e) => { setDraftName(e.target.value); setOverwriting(null); setSaveError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitSave(); } }}
          />
          {overwriting ? (
            <p className="text-sm text-text-2">
              A view called “{overwriting.name}” already exists. Saving replaces its filters.
            </p>
          ) : (
            <p className="text-xs text-text-3">
              Saves the current filters, including the {filters.viewMode === "board" ? "board" : "list"} view.
            </p>
          )}
          {saveError && <p className="text-sm text-danger">{saveError}</p>}
        </div>
      </Dialog>

      {/* SV-03: delete is confirm-gated. Nothing else is affected — a view is a bookmark. */}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => !remove.isPending && setConfirmDelete(null)}
        title={confirmDelete ? `Delete “${confirmDelete.name}”?` : ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={submitDelete} loading={remove.isPending}>
              Delete view
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-2">
          This removes the saved view. Your leads and filters are not affected.
        </p>
      </Dialog>
    </div>
  );
}
