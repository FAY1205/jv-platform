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

function DueChip({ dueOn, doneAt, today }: { dueOn: string | null; doneAt: string | null; today: string }) {
  const chip = dueChipFor(dueOn, doneAt, today);
  return <span className={cn("num rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", TONE_CLASS[chip.tone])}>{chip.label}</span>;
}

export function TasksPanel({ leadRef, today, onTaskChanged }: TasksPanelProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = React.useMemo(() => ["lead-tasks", leadRef], [leadRef]);
  const todayStr = today ?? utcDateString(new Date());

  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ tasks: LeadTask[] }>(`/api/leads/${leadRef}/tasks`) });
  const tasks = q.data?.tasks ?? [];
  const openCount = tasks.filter((t) => !t.doneAt).length;

  const settle = () => {
    qc.invalidateQueries({ queryKey: key });
    onTaskChanged?.();
  };

  // TSK-04: optimistic complete/reopen, rolled back + toasted on failure.
  const toggle = useMutation({
    mutationFn: (t: LeadTask) => apiMutate(`/api/tasks/${t.id}`, "PATCH", { action: t.doneAt ? "reopen" : "complete" }),
    onMutate: async (t: LeadTask) => {
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
    onSettled: settle,
  });

  // TSK-05: delete — author-only + open-only, enforced server-side; a rejection (403/404/409)
  // surfaces as a toast (WP-TSK-4 spec: "surface the 404/error as a toast").
  const del = useMutation({
    mutationFn: (id: string) => apiMutate(`/api/tasks/${id}`, "DELETE"),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ tasks: LeadTask[] }>(key);
      qc.setQueryData<{ tasks: LeadTask[] }>(key, (old) => (old ? { tasks: old.tasks.filter((x) => x.id !== id) } : old));
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.toast(err instanceof Error ? err.message : "Could not delete the task.", "danger");
    },
    onSettled: settle,
  });

  const [adding, setAdding] = React.useState(false);

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
            const isToggling = toggle.isPending && toggle.variables?.id === t.id;
            const isDeleting = del.isPending && del.variables === t.id;
            return (
              <li key={t.id} className="flex items-start gap-2.5 border-t border-border-soft py-2.5 first:border-t-0 first:pt-0">
                <Checkbox
                  checked={Boolean(t.doneAt)}
                  onCheckedChange={() => toggle.mutate(t)}
                  disabled={isToggling || isDeleting}
                  ariaLabel={t.doneAt ? `Reopen "${t.title}"` : `Mark "${t.title}" done`}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm font-medium text-text", t.doneAt && "text-text-3 line-through")}>{t.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <DueChip dueOn={t.dueOn} doneAt={t.doneAt} today={todayStr} />
                    {!t.doneAt && (
                      <button
                        type="button"
                        onClick={() => del.mutate(t.id)}
                        disabled={isDeleting || isToggling}
                        className="rounded text-xs font-semibold text-text-3 underline-offset-2 outline-none transition-colors hover:text-danger hover:underline focus-visible:ring-1 focus-visible:ring-brand-ink disabled:pointer-events-none disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
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
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            settle();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2.5 flex w-full items-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-left text-sm text-text-3 outline-none transition-colors hover:border-brand-line hover:text-text-2 focus-visible:ring-1 focus-visible:ring-brand-ink"
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
