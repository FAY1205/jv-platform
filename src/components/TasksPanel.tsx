"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { utcDateString } from "@/modules/tasks/dates";
import { TASK_TITLE_MAX } from "@/modules/tasks/schema";
import { dueChipFor, type DueChipTone } from "@/lib/task-due-chip";
import { cn } from "@/lib/cn";
import { Badge } from "./Badge";
import { Checkbox } from "./Checkbox";
import { Input } from "./Input";
import { DatePicker } from "./DatePicker";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { QueryErrorState } from "./QueryErrorState";
import { useToast } from "./Toast";

// TasksPanel (TSK-01..05, WP-TSK-4) — the per-lead work-item list from the approved
// mockup: open tasks first (checkbox, title, due chip), completed ones struck-through
// below. Shared by the admin lead dialog and the portal lead detail: the underlying
// endpoint (/api/leads/[ref]/tasks, /api/tasks/[id]) already scopes to the caller's own
// stream (PRN-13/ADR-0044) — this component only renders what the server hands back, it
// never invents an assignee name or any other field the payload doesn't carry.
//
// Assignee picker: intentionally NOT built here (TSK-03 progressive disclosure — v1
// silently self-assigns). Title/due EDITING is deferred too (WP candidate, noted in the
// WP-TSK-4 summary) — v1 supports add / complete / reopen / delete only.

export interface LeadTask {
  id: string;
  title: string;
  dueOn: string | null;
  assignedToUserId: string | null;
  authorUserId: string;
  authorRole: string;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TasksPanelProps {
  leadRef: string;
  /** Injected "today" (TSK-10 discipline) — tests pass a fixed date; defaults to now. */
  today?: string;
  /** Fires after any task add/toggle/delete settles, so the host can refresh its own
   *  lead-detail query (the Timeline's activity[] lives there, not in this panel's data). */
  onTaskChanged?: () => void;
}

const TONE_CLASS: Record<DueChipTone, string> = {
  danger: "border-danger/45 bg-danger-soft text-danger",
  warn: "border-warn/45 bg-warn-soft text-warn",
  neutral: "border-border bg-surface text-text-2",
};

// pr F-2: a shared `useMutation` per-row pending flag can't be read off `.isPending` /
// `.variables` alone — those reflect only the LAST call, so mutating row B while row A's
// PATCH is still in flight makes row A's `variables` stale and its control re-enables
// early. These two tiny set helpers back a local `Set<id>` instead, updated in
// onMutate/onSettled, so every row's pending state is independently correct.
function withAdded<T>(set: ReadonlySet<T>, id: T): ReadonlySet<T> {
  if (set.has(id)) return set;
  const next = new Set(set);
  next.add(id);
  return next;
}
function withRemoved<T>(set: ReadonlySet<T>, id: T): ReadonlySet<T> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

// Design F-3: the mockup's chips are plain sans text — only the date fragment (if any)
// renders tabular/mono, not the whole label ("Overdue · ", "Done · " stay plain).
function DueChip({ dueOn, doneAt, today }: { dueOn: string | null; doneAt: string | null; today: string }) {
  const chip = dueChipFor(dueOn, doneAt, today);
  const prefix = chip.dateText ? chip.label.slice(0, chip.label.length - chip.dateText.length) : chip.label;
  return (
    <span className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", TONE_CLASS[chip.tone])}>
      {prefix}
      {chip.dateText && <span className="num">{chip.dateText}</span>}
    </span>
  );
}

export function TasksPanel({ leadRef, today, onTaskChanged }: TasksPanelProps) {
  const qc = useQueryClient();
  const toast = useToast();
  // Namespaces the per-row checkbox DOM id (design F-2's hit-area label needs an id to
  // point `htmlFor` at) so two TasksPanel instances on one page — the gallery renders
  // several — can never collide even if their demo task ids happen to match.
  const panelId = React.useId();
  const key = React.useMemo(() => ["lead-tasks", leadRef], [leadRef]);
  const todayStr = today ?? utcDateString(new Date());

  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ tasks: LeadTask[] }>(`/api/leads/${leadRef}/tasks`) });
  const tasks = q.data?.tasks ?? [];
  const openCount = tasks.filter((t) => !t.doneAt).length;

  const settle = () => {
    qc.invalidateQueries({ queryKey: key });
    onTaskChanged?.();
  };

  const [pendingToggleIds, setPendingToggleIds] = React.useState<ReadonlySet<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = React.useState<ReadonlySet<string>>(new Set());

  // TSK-04: optimistic complete/reopen, rolled back + toasted on failure.
  const toggle = useMutation({
    mutationFn: (t: LeadTask) => apiMutate(`/api/tasks/${t.id}`, "PATCH", { action: t.doneAt ? "reopen" : "complete" }),
    onMutate: async (t: LeadTask) => {
      setPendingToggleIds((s) => withAdded(s, t.id));
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ tasks: LeadTask[] }>(key);
      qc.setQueryData<{ tasks: LeadTask[] }>(key, (old) =>
        old ? { tasks: old.tasks.map((x) => (x.id === t.id ? { ...x, doneAt: x.doneAt ? null : new Date().toISOString() } : x)) } : old,
      );
      return { prev };
    },
    onError: (err, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.toast(err instanceof Error ? err.message : "Could not update the task.", "danger");
    },
    onSettled: (_data, _err, t) => {
      setPendingToggleIds((s) => withRemoved(s, t.id));
      settle();
    },
  });

  // TSK-05: delete — author-only + open-only, enforced server-side; a rejection (403/404/409)
  // surfaces as a toast (WP-TSK-4 spec: "surface the 404/error as a toast"). pr F-1: gated
  // behind a two-click inline confirm (Delete → Confirm/Cancel in the same row) — matches
  // the house convention every other ownership/data-loss action in this app follows.
  const del = useMutation({
    mutationFn: (id: string) => apiMutate(`/api/tasks/${id}`, "DELETE"),
    onMutate: async (id: string) => {
      setPendingDeleteIds((s) => withAdded(s, id));
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ tasks: LeadTask[] }>(key);
      qc.setQueryData<{ tasks: LeadTask[] }>(key, (old) => (old ? { tasks: old.tasks.filter((x) => x.id !== id) } : old));
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.toast(err instanceof Error ? err.message : "Could not delete the task.", "danger");
    },
    onSettled: (_data, _err, id) => {
      setPendingDeleteIds((s) => withRemoved(s, id));
      settle();
    },
  });
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const [adding, setAdding] = React.useState(false);
  // pr F-5: focus returns to the "+ Add a task" trigger on cancel AND after a successful
  // add, since the form that had focus just unmounted. The trigger only re-enters the DOM
  // once `adding` flips back to `false` (a re-render away), so the focus call is queued for
  // the next paint rather than fired synchronously here.
  const addTriggerRef = React.useRef<HTMLButtonElement>(null);
  const returnFocusToAddTrigger = () => {
    requestAnimationFrame(() => addTriggerRef.current?.focus());
  };

  return (
    <div className="rounded-xl border border-border-soft bg-surface-2 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-step-1 font-semibold uppercase tracking-wide text-brand-ink">Tasks</h3>
        {!q.isPending && !q.isError && <Badge variant="neutral">{openCount} open</Badge>}
      </div>

      {q.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : q.isError ? (
        <QueryErrorState compact title="Couldn't load tasks" error={q.error} onRetry={() => q.refetch()} />
      ) : tasks.length === 0 ? (
        <EmptyState compact title="No tasks yet." />
      ) : (
        <ul className="flex flex-col">
          {tasks.map((t) => {
            const isToggling = pendingToggleIds.has(t.id);
            const isDeleting = pendingDeleteIds.has(t.id);
            const checkboxId = `${panelId}-task-${t.id}`;
            return (
              <li key={t.id} className="flex items-start gap-2 border-t border-border-soft first:border-t-0">
                {/* Design F-2 (WP-N floor): a 44x44 hit area around the 16px visual box —
                    a native `<label for>` targeting the Checkbox's underlying button, so no
                    extra click-handling is needed; the visual box itself stays desktop-dense. */}
                <label htmlFor={checkboxId} className="-ml-2 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-md">
                  <Checkbox
                    id={checkboxId}
                    checked={Boolean(t.doneAt)}
                    onCheckedChange={() => toggle.mutate(t)}
                    disabled={isToggling || isDeleting}
                    ariaLabel={t.doneAt ? `Reopen "${t.title}"` : `Mark "${t.title}" done`}
                  />
                </label>
                <div className="min-w-0 flex-1 py-2.5">
                  <div className={cn("text-sm font-medium text-text", t.doneAt && "text-text-3 line-through")}>{t.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <DueChip dueOn={t.dueOn} doneAt={t.doneAt} today={todayStr} />
                    {!t.doneAt &&
                      (confirmDeleteId === t.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(null);
                              del.mutate(t.id);
                            }}
                            disabled={isDeleting}
                            aria-label={`Confirm delete "${t.title}"`}
                            className="rounded text-xs font-semibold text-danger underline-offset-2 outline-none transition-[color,transform] hover:underline focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.97] disabled:pointer-events-none disabled:opacity-50"
                          >
                            Confirm
                          </button>
                          <span className="text-text-3" aria-hidden="true">
                            ·
                          </span>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={isDeleting}
                            aria-label={`Cancel delete "${t.title}"`}
                            className="rounded text-xs font-semibold text-text-3 underline-offset-2 outline-none transition-[color,transform] hover:text-text-2 hover:underline focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.97] disabled:pointer-events-none disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(t.id)}
                          disabled={isToggling}
                          aria-label={`Delete "${t.title}"`}
                          className="rounded text-xs font-semibold text-text-3 underline-offset-2 outline-none transition-[color,transform] hover:text-danger hover:underline focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.97] disabled:pointer-events-none disabled:opacity-50"
                        >
                          Delete
                        </button>
                      ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!q.isPending && !q.isError && (adding ? (
        <AddTaskForm
          leadRef={leadRef}
          onCancel={() => {
            setAdding(false);
            returnFocusToAddTrigger();
          }}
          onAdded={() => {
            setAdding(false);
            settle();
            returnFocusToAddTrigger();
          }}
        />
      ) : (
        <button
          ref={addTriggerRef}
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2.5 flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-left text-sm text-text-3 outline-none transition-colors hover:border-brand-line hover:text-text-2 focus-visible:ring-1 focus-visible:ring-brand-ink"
        >
          <span className="text-base leading-none text-brand-ink" aria-hidden="true">
            +
          </span>
          Add a task
        </button>
      ))}
    </div>
  );
}

function AddTaskForm({ leadRef, onCancel, onAdded }: { leadRef: string; onCancel: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [title, setTitle] = React.useState("");
  const [dueOn, setDueOn] = React.useState<string | null>(null);
  const trimmed = title.trim();
  // TSK-01: 1..200 chars, trimmed — mirrors CreateTaskSchema so the client never
  // submits something the server will 400 on.
  const titleError = trimmed.length > TASK_TITLE_MAX ? `Keep the title under ${TASK_TITLE_MAX} characters.` : null;
  const canSave = trimmed.length > 0 && !titleError;

  const add = useMutation({
    mutationFn: () => apiMutate<{ id: string }>(`/api/leads/${leadRef}/tasks`, "POST", { title: trimmed, dueOn }),
    onSuccess: onAdded,
    onError: (err) => toast.toast(err instanceof Error ? err.message : "Could not add the task.", "danger"),
  });

  return (
    <form
      className="mt-2.5 flex flex-col gap-2.5 rounded-lg border border-border-strong bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) add.mutate();
      }}
    >
      <Input
        autoFocus
        label="Task title"
        placeholder="e.g. Call seller to schedule walkthrough"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={titleError ?? undefined}
        disabled={add.isPending}
      />
      <DatePicker label="Due date (optional)" value={dueOn} onChange={setDueOn} disabled={add.isPending} />
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={add.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={add.isPending} disabled={!canSave}>
          Add task
        </Button>
      </div>
    </form>
  );
}
