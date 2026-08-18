"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";
import { tagDotClass } from "@/lib/tag-chip";
import { Input } from "./Input";

// WP-TAG-1 (TAG-04) — the ＋ tag picker: type-ahead over the tenant's tags plus
// create-inline for a name that doesn't exist yet. Radix Popover for positioning +
// dismissal (ADR-0016), the hand-rolled ARIA combobox pattern inside it — exactly the
// StateMultiSelect recipe, including the anchor-interaction guards that stop Radix from
// dismissing the menu when you click the input it is anchored to.
//
// The picker is DUMB: it never mutates. It reports "attach this id" / "create this name"
// upward, so the same component serves the leads list, the board card, and the filter row
// (where "attach" means "add to the filter" and create-inline is switched off).

export interface TagPickerOption {
  id: string;
  name: string;
  color: string;
  /** Optional usage count shown on the right of a row (the mockup's "14 leads"). */
  leadCount?: number;
}

export interface TagPickerProps {
  options: readonly TagPickerOption[];
  /** Ids already on the lead (or already in the filter) — hidden from the list. */
  selectedIds: readonly string[];
  onSelect: (tagId: string) => void;
  /** Omitted ⇒ no create-inline row (the filter row can only pick what exists). */
  onCreate?: (name: string) => void;
  /** TAG-08: the tenant is at its server-side tag cap. The create-inline row is replaced by a
   *  non-interactive hint; picking existing tags is untouched. Parents derive this from the
   *  roster payload via `atTagLimit` — the number itself is never hardcoded here. */
  atLimit?: boolean;
  /** True while an attach/create is in flight: the trigger disables, the menu stays put. */
  busy?: boolean;
  disabled?: boolean;
  /** Trigger presentation: the round ＋ on a row/card, or a text chip in the filter row. */
  variant?: "icon" | "chip";
  triggerLabel?: string;
  placeholder?: string;
  className?: string;
}

export function TagPicker({
  options,
  selectedIds,
  onSelect,
  onCreate,
  atLimit = false,
  busy = false,
  disabled = false,
  variant = "icon",
  triggerLabel = "Add a tag",
  placeholder = "Add or create a tag…",
  className,
}: TagPickerProps) {
  const listboxId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [active, setActive] = React.useState(0);
  const contentRef = React.useRef<HTMLDivElement>(null);

  const selected = new Set(selectedIds);
  const q = text.trim().toLowerCase();
  const available = options.filter((o) => !selected.has(o.id));
  // NO debounce, deliberately (FEP-04): that rule targets keystrokes re-rendering TABLES.
  // This filter re-renders a bounded (≤ TAG_LIMIT) list inside Popover.Content and nothing
  // outside it; a debounce here would buy nothing and add typing lag. Please don't "fix" it.
  const filtered = q ? available.filter((o) => o.name.toLowerCase().includes(q)) : available;

  // Create-inline appears only for a non-empty name that is not ALREADY a tag — including
  // one that is already on this lead (case-insensitively), which would otherwise offer to
  // create a duplicate the server would 409. Names are unique per tenant, case-insensitively.
  const exact = text.trim() && options.some((o) => o.name.toLowerCase() === q);
  const wantsCreate = Boolean(onCreate) && Boolean(text.trim()) && !exact;
  const canCreate = wantsCreate && !atLimit;
  // TAG-08: at the cap, the create row's slot carries an explanation instead of an offer —
  // the operator sees WHY nothing appeared rather than a silently missing affordance.
  const showLimitHint = wantsCreate && atLimit;

  // TAG-09: the roster's size is otherwise invisible past the ~7 rows the scroller shows —
  // an operator can't tell 53 tags from 15 without scrolling. Below ~one scroller-screen the
  // line is noise, so it appears only past the threshold. Text, never colour (PRN-14).
  const COUNT_LINE_MIN = 25;
  const showCountLine = options.length > COUNT_LINE_MIN;

  const reset = React.useCallback(() => {
    setText("");
    setActive(0);
  }, []);

  const pick = (tagId: string) => {
    onSelect(tagId);
    reset();
    setOpen(false);
  };
  const create = () => {
    onCreate?.(text.trim());
    reset();
    setOpen(false);
  };

  /**
   * FEP-03/a11y: the listbox is a ~7-row scroller, so past that the arrow keys walk the
   * highlight straight off the bottom and the operator is navigating blind. Follow it.
   * KEYBOARD-ONLY — deliberately not called from the rows' `onMouseEnter`, which also moves
   * `active`: scrolling under a hovering cursor yanks the list out from under it.
   * `block: "nearest"` is the minimal correction (no jump when the row is already visible).
   */
  const scrollActiveIntoView = (i: number) => {
    requestAnimationFrame(() =>
      document.getElementById(`${listboxId}-${i}`)?.scrollIntoView({ block: "nearest" }),
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // The create row is the last stop of the same arrow-key run, so the keyboard path can
    // reach it without a mouse (a11y: create-inline is not mouse-only). The at-cap hint row
    // is NOT a row here: it is inert, so the arrow run stops at the last real option.
    const rows = filtered.length + (canCreate ? 1 : 0);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(Math.max(active + delta, 0), Math.max(rows - 1, 0));
      setActive(next);
      scrollActiveIntoView(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < filtered.length && filtered[active]) pick(filtered[active].id);
      else if (canCreate) create();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const trigger =
    variant === "chip" ? (
      <button
        type="button"
        aria-label={triggerLabel}
        disabled={disabled || busy}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong px-1.5 py-0.5 text-xs font-semibold text-text-3",
          "outline-none transition-colors hover:border-brand-ink hover:text-brand-ink focus-visible:ring-1 focus-visible:ring-brand-ink",
          "active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=open]:border-brand-ink data-[state=open]:text-brand-ink",
        )}
      >
        ＋ {triggerLabel}
      </button>
    ) : (
      <button
        type="button"
        aria-label={triggerLabel}
        disabled={disabled || busy}
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-xs leading-none text-text-3",
          "outline-none transition-colors hover:border-brand-ink hover:text-brand-ink focus-visible:ring-1 focus-visible:ring-brand-ink",
          "active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=open]:border-brand-ink data-[state=open]:text-brand-ink",
        )}
      >
        ＋
      </button>
    );

  return (
    <Popover.Root
      open={open && !disabled}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      {/* The chips sit inside clickable rows/cards — stop the trigger's click there. */}
      <Popover.Trigger asChild onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <span className={cn("inline-flex", className)}>{trigger}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          side="bottom"
          align="start"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          // Interactions inside the menu are ours; a genuinely outside one still dismisses.
          onInteractOutside={(e) => {
            if (contentRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          className="z-[200] w-56 rounded-lg border border-border-strong bg-surface p-2 shadow-md"
        >
          <Input
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={`${listboxId}-${active}`}
            aria-label={triggerLabel}
            autoFocus
            value={text}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {/* Outside the listbox (it is not an option) and with NO aria-live: it changes on
              every keystroke and would chatter. Screen readers reach it in reading order. */}
          {showCountLine && (
            <div className="px-2 pt-1 text-step-0 text-text-3">
              {q ? `${filtered.length} of ${available.length} match` : `${available.length} tags — type to filter`}
            </div>
          )}
          {/* Geometry is deliberately unchanged (w-56 / max-h-56): 7 visible rows + type-ahead
              + keyboard scroll-follow + the count line is the right shape. A taller menu just
              moves the problem and starts colliding with the viewport on board cards. */}
          <ul id={listboxId} role="listbox" aria-label={triggerLabel} className="mt-1.5 max-h-56 overflow-auto">
            {filtered.length === 0 && !canCreate && (
              <li className="px-2 py-1.5 text-xs text-text-3">
                {options.length === 0 ? "No tags yet — type a name to create one." : "No matches"}
              </li>
            )}
            {filtered.map((o, i) => (
              <li
                key={o.id}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                  i === active ? "bg-surface-2 text-text" : "text-text-2",
                )}
              >
                {/* Decorative — the tag NAME sits right beside it (PRN-14). */}
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", tagDotClass(o.color))} aria-hidden="true" />
                <span className="truncate">{o.name}</span>
                {o.leadCount !== undefined && (
                  <span className="num ml-auto shrink-0 text-step-0 text-text-3">{o.leadCount}</span>
                )}
              </li>
            ))}
            {canCreate && (
              <li
                id={`${listboxId}-${filtered.length}`}
                role="option"
                aria-selected={active === filtered.length}
                onMouseEnter={() => setActive(filtered.length)}
                onClick={create}
                className={cn(
                  "mt-1 cursor-pointer truncate rounded-md border-t border-border px-2 pb-1.5 pt-2 text-xs font-semibold text-brand-ink",
                  active === filtered.length ? "bg-surface-2" : "",
                )}
              >
                ＋ Create “{text.trim()}”
              </li>
            )}
            {/* TAG-08: the create row's slot at the cap. A plain <li> — no role="option", no
                id, not counted in `rows`, so it is unreachable by the arrow keys and Enter
                can never "pick" it. It explains, it does not offer. */}
            {showLimitHint && (
              <li className="mt-1 border-t border-border px-2 pb-1.5 pt-2 text-xs text-text-3">
                Tag limit reached — manage tags in Settings.
              </li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
