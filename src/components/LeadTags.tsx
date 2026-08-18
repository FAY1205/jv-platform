"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { TagChip, HotTagChip, TagOverflowChip } from "./TagChip";
import { TagPicker, type TagPickerOption } from "./TagPicker";

// WP-TAG-1 (TAG-04/TAG-05) — one lead's chip row: the Hot smart tag (when the scorer says
// so), then the stored tags, then the ＋ picker. Used by BOTH the leads list (uncapped) and
// the board card (capped at 2 + "+n"), so the two surfaces can never drift apart.
//
// Presentational only — every mutation is reported upward. The Hot chip is rendered from the
// score fields the row already carries, never from a stored tag (PRN-15), which is why it
// takes no id and offers no ✕.

export interface LeadTagView {
  id: string;
  name: string;
  color: string;
}

export interface LeadTagsProps {
  tags: readonly LeadTagView[];
  /** TAG-05: the smart tag. Render it only for a KEPT, hot lead with a real total — the
   *  same rule HotLeadMark follows, so a removed-from-MLS lead shows no Hot chip. */
  hot?: boolean;
  hotScore?: number | null;
  /** Max STORED chips to render; the rest collapse into "+n" (board cards pass 2). */
  max?: number;
  /** Dense single-line row treatment (the admin leads TABLE): no wrapping, a default cap of
   *  2 chips, and each chip width-clamped so one long name can't push the row's other cells
   *  off. Keeps row heights constant (the owner-reported "tags render awkwardly"). Board
   *  cards keep their own (capped, wrapping) treatment. */
  dense?: boolean;
  /** Omit the picker + ✕ entirely (a read-only surface). */
  editable?: boolean;
  /** The tenant's tag roster for the picker's type-ahead. */
  options?: readonly TagPickerOption[];
  onAttach?: (tagId: string) => void;
  onDetach?: (tagId: string) => void;
  onCreate?: (name: string) => void;
  /** TAG-08: the tenant is at its tag cap — the picker swaps create-inline for a hint. */
  atLimit?: boolean;
  /** A mutation is in flight: ✕ buttons and the ＋ trigger disable, nothing moves. */
  busy?: boolean;
  /** WP-UX-3 (audit 1.6/2.4): render the ＋ trigger only on row/card hover or keyboard
   *  focus. Requires a `group` class on the hosting row/card. The trigger stays in the
   *  tab order (opacity, not display) — focus reveals it for keyboard users. Rows of
   *  identical dashed ghosts were the loudest empty chrome in the audit. */
  quietAdd?: boolean;
  className?: string;
}

export function LeadTags({
  tags,
  hot = false,
  hotScore = null,
  max,
  dense = false,
  editable = false,
  options = [],
  onAttach,
  onDetach,
  onCreate,
  atLimit = false,
  busy = false,
  quietAdd = false,
  className,
}: LeadTagsProps) {
  // Dense rows cap at 2 stored chips by default (an explicit `max` still wins) and never wrap.
  const effectiveMax = max ?? (dense ? 2 : undefined);
  const shown = effectiveMax === undefined ? tags : tags.slice(0, effectiveMax);
  const hidden = effectiveMax === undefined ? [] : tags.slice(effectiveMax).map((t) => t.name);
  const showHot = hot && hotScore !== null && hotScore !== undefined;

  return (
    <div className={cn("flex items-center gap-1", !dense && "flex-wrap", className)}>
      {/* The smart tag leads the row: it is the one chip that is always true of the lead. */}
      {showHot && <HotTagChip score={hotScore} />}
      {shown.map((t) => (
        <TagChip
          key={t.id}
          name={t.name}
          color={t.color}
          busy={busy}
          // Dense: clamp each chip so a long name truncates (with its name in the tooltip)
          // instead of shoving the row's date/status cells sideways.
          className={dense ? "max-w-32" : undefined}
          onRemove={editable && onDetach ? () => onDetach(t.id) : undefined}
        />
      ))}
      {hidden.length > 0 && <TagOverflowChip hidden={hidden} />}
      {editable && onAttach && (
        <span
          className={cn(
            quietAdd &&
              "opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
          data-testid={quietAdd ? "quiet-add" : undefined}
        >
          <TagPicker
            options={options}
            selectedIds={tags.map((t) => t.id)}
            onSelect={onAttach}
            onCreate={onCreate}
            atLimit={atLimit}
            busy={busy}
          />
        </span>
      )}
    </div>
  );
}
