"use client";

import * as React from "react";
import { fmtDateTime } from "@/lib/dates";
import { ClampedText } from "./ClampedText";
import { EmptyState } from "./EmptyState";
import { FilterPill } from "./FilterPill";

// Timeline (TSK-06, WP-TSK-4) — the unified per-lead activity feed: system events
// (imported/routed/assigned), status changes, notes, and task events, newest first.
// Replaces the flat "Activity" list stopgap that TSK-3 shipped. Shared by the admin
// lead dialog and the portal lead dialog (the server already scopes `activity` per
// caller — PRN-08 — this component only renders what it is given, never invents data).

// Mirrors LeadActivityKind (modules/leads/timeline) per the queries.ts:494 convention — the
// client re-declares the read-model's shape, so a kind added there is added here too.
export type TimelineEntryKind =
  | "imported"
  | "routed"
  | "assigned"
  | "status"
  | "note"
  | "task_created"
  | "task_completed"
  /** N5-14 — "Details updated: phone, email". Admin feed only; the portal never emits it. */
  | "details_updated";

export interface TimelineEntry {
  kind: TimelineEntryKind;
  at: string;
  label: string;
  actor: string | null;
  status?: string;
  /** kind "note" only — the note body, rendered inline (PRN-10: text only, never HTML). */
  body?: string;
  /** kinds "task_created" / "task_completed" only — the task title. */
  title?: string;
}

// Tokens only (PRN-12). task_created and task_completed intentionally share one dot —
// they are told apart by their label text, never by color alone (PRN-14).
const DOT: Record<TimelineEntryKind, string> = {
  imported: "bg-info",
  routed: "bg-brand",
  assigned: "bg-prev",
  status: "bg-warn",
  note: "bg-prev",
  task_created: "bg-success",
  task_completed: "bg-success",
  // Shares `assigned`'s dot: both are "a person changed this record" facts, told apart by
  // their label text, never by color (PRN-14) — the same call task_created/task_completed made.
  details_updated: "bg-prev",
};

type TimelineFilter = "all" | "tasks" | "notes" | "status";

const FILTERS: { value: TimelineFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tasks", label: "Tasks" },
  { value: "notes", label: "Notes" },
  { value: "status", label: "Status" },
];

/** TSK-06: system events (imported/routed/assigned) show under "All" only — they have
 *  no chip of their own. Exported so its mapping is unit-testable without a DOM.
 *
 *  N5-14: `details_updated` joins them there rather than gaining a chip. The three chips are
 *  the three STREAMS a reader filters by (their tasks, their notes, the status trail); a field
 *  correction is none of them, and it is not a status change — putting it under Status would
 *  make "No status changes yet" and the C-12 empty copy lie. A "Changes" chip is a candidate,
 *  not a thing to invent inside this WP. */
export function matchesTimelineFilter(kind: TimelineEntryKind, filter: TimelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "tasks") return kind === "task_created" || kind === "task_completed";
  if (filter === "notes") return kind === "note";
  if (filter === "status") return kind === "status";
  return false;
}

export function Timeline({ activity }: { activity: TimelineEntry[] }) {
  const [filter, setFilter] = React.useState<TimelineFilter>("all");
  const filtered = React.useMemo(() => activity.filter((a) => matchesTimelineFilter(a.kind, filter)), [activity, filter]);

  return (
    <div className="rounded-xl border border-border-soft bg-surface-2 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {/* WP-UX-7 (audit 3.1): unified section-header treatment (amber reserved for links). */}
        <h3 className="text-step-1 font-semibold uppercase tracking-wide text-text-2">Timeline</h3>
        <div role="group" aria-label="Filter timeline" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <FilterPill key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </FilterPill>
          ))}
        </div>
      </div>

      {activity.length === 0 ? (
        <EmptyState compact title="No activity yet." />
      ) : filtered.length === 0 ? (
        /* C-12: the Status filter inherits the retired portal panel's line, which explains
           WHY the list is empty rather than only that it is. The other filters keep the
           generic copy (per-filter wording for notes/tasks is a WP candidate). */
        <EmptyState
          compact
          title={filter === "status" ? "No status changes yet — the current status is the default." : "Nothing matches this filter."}
        />
      ) : (
        <ol className="flex flex-col">
          {filtered.map((a, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface-2 ${DOT[a.kind]}`} aria-hidden="true" />
                {i < filtered.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
              </div>
              <div className="flex flex-1 flex-col pb-4">
                <span className="text-sm text-text">{a.label}</span>
                {/* Note bodies are free text a human typed (PRN-10) — rendered as text,
                    never HTML, in a bordered sub-block per the approved mockup. */}
                {a.body ? (
                  <div className="mt-1.5 rounded-md border border-l-2 border-border border-l-prev bg-surface px-2.5 py-2">
                    <ClampedText lines={3} className="text-text-2">
                      {a.body}
                    </ClampedText>
                  </div>
                ) : a.title ? (
                  <span className="mt-0.5 text-sm text-text-2">{a.title}</span>
                ) : null}
                <span className="num mt-1 text-xs text-text-3">
                  {fmtDateTime(a.at)}
                  {a.actor ? ` · ${a.actor}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
