"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { utcDateString, groupByDue, DUE_GROUPS, type DueGroup } from "@/modules/tasks/dates";
import { withAdded, withRemoved } from "@/lib/pending-set";
import { cn } from "@/lib/cn";
import { Card, CardHeader, CardTitle, CardBody } from "./Card";
import { Badge } from "./Badge";
import { DueChip } from "./DueChip";
import { Checkbox } from "./Checkbox";
import { SegmentedControl } from "./SegmentedControl";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { QueryErrorState } from "./QueryErrorState";
import { useToast } from "./Toast";

// MyTasksList (TSK-07, WP-TSK-5) — the "My Tasks" view from the approved mockup Screen 2,
// shared verbatim by the admin `/tasks` page and the portal `/portal/tasks` page (the
// mockup is explicitly one screen for both). GET /api/tasks already scopes to the caller's
// own stream (PRN-13/ADR-0044) and paginates server-side (TSK-07) — this component only
// renders what the payload hands back; it never invents a field the API doesn't return
// (the mockup's "· Marcus Whitfield · Phoenix, AZ" seller/city context has no home in
// MyTaskItem today — omitted rather than fabricated, noted as a WP-TSK-5 gap below).

export interface MyTask {
  id: string;
  title: string;
  dueOn: string | null;
  assignedToUserId: string | null;
  authorUserId: string;
  authorRole: string;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
  leadRefId: string;
  // WP-UX-7: the lead's identity, so a row says WHICH lead without a click-through.
  leadSeller: string;
  leadCity: string | null;
  leadState: string | null;
  /** Server-computed TSK-10 bucket. Kept for type-fidelity with the /api/tasks payload,
   *  but NOT what this component groups by — see the client-side re-group note below. */
  group: DueGroup;
}

interface MyTasksPage {
  items: MyTask[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MyTasksListProps {
  /** The lead deep-link base — "/leads?open=" (admin) or "/portal/leads?open=" (portal),
   *  the same ?open=<ref> convention the notifications and Leads pages already use
   *  (retired /leads/[ref] and /portal/leads/[ref] pages both redirect through it). */
  leadHrefBase: string;
  /** Injected "today" (TSK-10 discipline) — tests pass a fixed date; defaults to now,
   *  computed ONCE at this component's boundary, never re-derived per row. */
  today?: string;
  /** The card heading. Defaults to "My Tasks"; pass `null` to omit it where the surrounding
   *  page already supplies the heading (the portal shows "Your tasks"), so the two don't
   *  repeat (WP-UX-7). The header's overdue badge + status filter are unaffected. */
  title?: string | null;
}

const GROUP_LABEL: Record<DueGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  none: "No due date",
};
const GROUP_DOT_CLASS: Record<DueGroup, string> = {
  overdue: "bg-danger",
  today: "bg-warn",
  upcoming: "bg-text-3",
  none: "bg-text-3",
};
const GROUP_TEXT_CLASS: Record<DueGroup, string> = {
  overdue: "text-danger",
  today: "text-warn",
  upcoming: "text-text-3",
  none: "text-text-3",
};
const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
] as const;

export function MyTasksList({ leadHrefBase, today, title = "My Tasks" }: MyTasksListProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const todayStr = today ?? utcDateString(new Date());
  const [status, setStatus] = React.useState<"open" | "done">("open");
  const [page, setPage] = React.useState(1);
  const key = React.useMemo(() => ["my-tasks", status, page] as const, [status, page]);

  const q = useQuery({ queryKey: key, queryFn: () => apiGet<MyTasksPage>(`/api/tasks?status=${status}&page=${page}`) });
  const items = q.data?.items ?? [];

  const [pendingToggleIds, setPendingToggleIds] = React.useState<ReadonlySet<string>>(new Set());
  // TSK-04: optimistic complete/reopen, rolled back + toasted on failure (identical shape
  // to TasksPanel's toggle mutation). A toggle always moves a task between the Open and
  // Done tabs, so onSettled invalidates every "my-tasks" page, not just the current one.
  const toggle = useMutation({
    mutationFn: (t: MyTask) => apiMutate(`/api/tasks/${t.id}`, "PATCH", { action: t.doneAt ? "reopen" : "complete" }),
    onMutate: async (t: MyTask) => {
      setPendingToggleIds((s) => withAdded(s, t.id));
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MyTasksPage>(key);
      qc.setQueryData<MyTasksPage>(key, (old) =>
        old ? { ...old, items: old.items.map((x) => (x.id === t.id ? { ...x, doneAt: x.doneAt ? null : new Date().toISOString() } : x)) } : old,
      );
      return { prev };
    },
    onError: (err, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.toast(err instanceof Error ? err.message : "Could not update the task.", "danger");
    },
    onSettled: (_data, _err, t) => {
      setPendingToggleIds((s) => withRemoved(s, t.id));
      qc.invalidateQueries({ queryKey: ["my-tasks"] });
    },
  });

  // TSK-07/TSK-10: grouping happens HERE, client-side, from the raw `dueOn` + the injected
  // `today` — never the server's `group` field — so the pure groupByDue predicate stays the
  // single source of truth for the bucket a task lands in. Scoped to the CURRENTLY FETCHED
  // PAGE only: a task on page 2 isn't counted here. A server-side grouping that spans every
  // page (so "3 overdue" is always the true total, not just this page's) is a future WP —
  // noted as a WP candidate in the WP-TSK-5 summary, not built here.
  //
  // Done tasks are never re-grouped by due date (a completed task isn't "overdue" just
  // because its due date has passed) — the Done tab renders a flat list; its due chip
  // already reads "Done · Aug 12" regardless of `dueOn`.
  const groups: { key: DueGroup; tasks: MyTask[] }[] =
    status === "open"
      ? DUE_GROUPS.map((g) => ({ key: g, tasks: items.filter((t) => groupByDue(t.dueOn, todayStr) === g) })).filter((g) => g.tasks.length > 0)
      : [];
  const overdueOnPage = status === "open" ? (groups.find((g) => g.key === "overdue")?.tasks.length ?? 0) : 0;

  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <Card>
      <CardHeader>
        {title !== null && <CardTitle as="h2">{title}</CardTitle>}
        {overdueOnPage > 0 && (
          // PRN-14: color never carries the meaning alone — the text "N overdue" says it too.
          <Badge variant="removed">{overdueOnPage} overdue</Badge>
        )}
        <span className="ml-auto" />
        <SegmentedControl
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
          ariaLabel="Task status filter"
        />
      </CardHeader>

      <CardBody className="flex flex-col gap-1">
        {q.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : q.isError ? (
          <QueryErrorState title="Couldn't load your tasks" error={q.error} onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={status === "done" ? "No completed tasks yet" : "No open tasks"}
            description={status === "done" ? "Tasks you complete will collect here." : "Open a lead and add a task — it shows up here, grouped by when it's due."}
          />
        ) : status === "done" ? (
          <ul className="flex flex-col">
            {items.map((t) => (
              <TaskRow key={t.id} task={t} today={todayStr} leadHrefBase={leadHrefBase} onToggle={() => toggle.mutate(t)} pending={pendingToggleIds.has(t.id)} />
            ))}
          </ul>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              {/* A real <h3> (h1 shell "Tasks" > h2 "My Tasks" > h3 group) — a scannable
                  landmark structure, not just styled text. */}
              <h3 className={cn("flex items-center gap-2 pt-3 pb-1 text-xs font-bold uppercase tracking-wide first:pt-1", GROUP_TEXT_CLASS[g.key])}>
                <span className={cn("h-1.5 w-1.5 rounded-full", GROUP_DOT_CLASS[g.key])} aria-hidden="true" />
                <span>{GROUP_LABEL[g.key]}</span>
                <span className="num font-semibold text-text-3">· {g.tasks.length}</span>
              </h3>
              <ul className="flex flex-col">
                {g.tasks.map((t) => (
                  // dateOnly: this section's header already names the state, so the chip shows just the date.
                  <TaskRow key={t.id} task={t} today={todayStr} leadHrefBase={leadHrefBase} dateOnly onToggle={() => toggle.mutate(t)} pending={pendingToggleIds.has(t.id)} />
                ))}
              </ul>
            </div>
          ))
        )}
      </CardBody>

      {/* WP-UX-7 (audit): the pager only exists past a single page — a "Page 1 of 1" with
          two dead chevrons read as unfinished chrome. */}
      {q.data && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-border-soft px-5 py-3">
          <span className="num text-xs text-text-3">
            Page {q.data.page} of {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-text-2 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-brand-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-text-2 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-brand-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function TaskRow({
  task,
  today,
  leadHrefBase,
  onToggle,
  pending,
  dateOnly = false,
}: {
  task: MyTask;
  today: string;
  leadHrefBase: string;
  onToggle: () => void;
  pending: boolean;
  dateOnly?: boolean;
}) {
  const checkboxId = React.useId();
  // WP-UX-7 (info design): the lead's who + where, so a row answers "which Smith?" — the
  // two identical "Call seller to confirm appointment" rows the audit flagged are now
  // distinguishable at a glance, not only after a click-through.
  const where = [task.leadCity, task.leadState].filter(Boolean).join(", ");
  return (
    // WP-N floor: min-h-11 (44px) keeps the whole row a comfortable touch target on the
    // portal's mobile surface, not just the checkbox's own hit area.
    <li className="flex min-h-11 items-center gap-2 border-t border-border-soft first:border-t-0">
      <label htmlFor={checkboxId} className="-ml-2 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-md">
        <Checkbox
          id={checkboxId}
          checked={Boolean(task.doneAt)}
          onCheckedChange={onToggle}
          disabled={pending}
          ariaLabel={task.doneAt ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
        />
      </label>
      <div className="min-w-0 flex-1 py-2">
        {/* WP-UX-7: titles wrap to two lines below md so the phone view stops truncating the
            task's own text at ~15 chars; one line with an ellipsis at wider widths. */}
        <div className={cn("text-sm font-medium text-text line-clamp-2 md:truncate", task.doneAt && "text-text-3 line-through")}>{task.title}</div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {/* TSK-07 deep link: same ?open=<ref> convention as notifications + the Leads page. */}
          <Link href={`${leadHrefBase}${encodeURIComponent(task.leadRefId)}`} className="num inline-block py-1 -my-1 font-semibold text-brand-ink hover:underline">
            {task.leadRefId}
          </Link>
          <span className="min-w-0 truncate text-text-2">
            {task.leadSeller}
            {where && <span className="text-text-3"> · {where}</span>}
          </span>
        </div>
      </div>
      <DueChip dueOn={task.dueOn} doneAt={task.doneAt} today={today} dateOnly={dateOnly} className="shrink-0" />
    </li>
  );
}
