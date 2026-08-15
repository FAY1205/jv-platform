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
  /** Omit the picker + ✕ entirely (a read-only surface). */
  editable?: boolean;
  /** The tenant's tag roster for the picker's type-ahead. */
  options?: readonly TagPickerOption[];
  onAttach?: (tagId: string) => void;
  onDetach?: (tagId: string) => void;
  onCreate?: (name: string) => void;
  /** A mutation is in flight: ✕ buttons and the ＋ trigger disable, nothing moves. */
  busy?: boolean;
  className?: string;
}

export function LeadTags({
  tags,
  hot = false,
  hotScore = null,
  max,
  editable = false,
  options = [],
  onAttach,
  onDetach,
  onCreate,
  busy = false,
  className,
}: LeadTagsProps) {
  const shown = max === undefined ? tags : tags.slice(0, max);
  const hidden = max === undefined ? [] : tags.slice(max).map((t) => t.name);
  const showHot = hot && hotScore !== null && hotScore !== undefined;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {/* The smart tag leads the row: it is the one chip that is always true of the lead. */}
      {showHot && <HotTagChip score={hotScore} />}
      {shown.map((t) => (
        <TagChip
          key={t.id}
          name={t.name}
          color={t.color}
          busy={busy}
          onRemove={editable && onDetach ? () => onDetach(t.id) : undefined}
        />
      ))}
      {hidden.length > 0 && <TagOverflowChip hidden={hidden} />}
      {editable && onAttach && (
        <TagPicker
          options={options}
          selectedIds={tags.map((t) => t.id)}
          onSelect={onAttach}
          onCreate={onCreate}
          busy={busy}
        />
      )}
    </div>
  );
}
