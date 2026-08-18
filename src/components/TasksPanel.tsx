"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { utcDateString } from "@/modules/tasks/dates";
import { TASK_TITLE_MAX } from "@/modules/tasks/schema";
import { withAdded, withRemoved } from "@/lib/pending-set";
import { useCurrentUser } from "@/lib/use-current-user";
import { cn } from "@/lib/cn";
import { Badge } from "./Badge";
import { DueChip } from "./DueChip";
import { Checkbox } from "./Checkbox";
import { Input } from "./Input";
import { DatePicker } from "./DatePicker";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { QueryErrorState } from "./QueryErrorState";
import { AvatarInitials } from "./AvatarInitials";
import { Tooltip } from "./Tooltip";
import { useToast } from "./Toast";

// TasksPanel (TSK-01..05, WP-TSK-4) — the per-lead work-item list from the approved
// mockup: open tasks first (checkbox, title, due chip), completed ones struck-through
// below. Shared by the admin lead dialog and the portal lead detail: the underlying
// endpoint (/api/leads/[ref]/tasks, /api/tasks/[id]) already scopes to the caller's own
// stream (PRN-13/ADR-0044) — this component only renders what the server hands back, it
// never invents an assignee name or any other field the payload doesn't carry.
//
// Assignee PICKER: intentionally NOT built here (TSK-03 progressive disclosure — v1
// silently self-assigns). Title/due EDITING is deferred too (WP candidate, noted in the
// WP-TSK-4 summary) — v1 supports add / complete / reopen / delete only. C-11 added the
// resolved assignee/author IDENTITY to the payload, so the row can now attribute work —
// still without inventing anything: an unresolvable identity renders nothing at all.

/** C-11: mirrors `TaskIdentity` in modules/tasks/tasks.ts (the leads-view re-declare
 *  convention this file already follows for LeadTask). */
export interface TaskIdentity {
  email: string;
  role: "admin" | "member" | "viewer" | "partner";
  deactivated: boolean;
}

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
  assignee: TaskIdentity | null;
  author: TaskIdentity | null;
}

export interface TasksPanelProps {
  leadRef: string;
  /** Injected "today" (TSK-10 discipline) — tests pass a fixed date; defaults to now. */
  today?: string;
  /** Fires after any task add/toggle/delete settles, so the host can refresh its own
   *  lead-detail query (the Timeline's activity[] lives there, not in this panel's data). */
  onTaskChanged?: () => void;
  /**
   * C-11 chrome-only write gate. Default: the caller must hold `work.write` — the admin
   * stream's rule, mirroring requireCapabilityResponse on /api/tasks/[id].
   *
   * The PORTAL host passes `true` instead, because on that surface the server gate is
   * `requirePassthroughResponse`: a PARTNER passes on SCOPE alone (ADR-0047 — partners hold
   * no capability by construction, so capabilitiesOf() returns [] for them) and the portal
   * layout redirects every admin-stream tier away. Gating the portal on a capability the
   * partner stream can never hold would make the partner's own task panel read-only.
   *
   * Chrome only either way — the routes stay authoritative (lib/use-current-user).
   */
  canWrite?: boolean;
}

/** The ONE identity a row shows: the assignee, coalescing to the author when unassigned —
 *  the same coalesce listMyTasks's "mine" predicate and TSK-08's recipient rule use. Pure,
 *  so the rule is unit-testable without a DOM. */
export function taskIdentity(task: Pick<LeadTask, "assignee" | "author">): TaskIdentity | null {
  return task.assignee ?? task.author ?? null;
}

const ROLE_WORD: Record<TaskIdentity["role"], string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
  partner: "Partner",
};

/**
 * The identity tooltip: full email · role word, plus the seat state when the user has been
 * deactivated (attribution persists — a closed seat keeps what it authored). When the
 * assignee and author BOTH resolve and DIFFER — only possible for a seeded/backfilled row
 * or a future picker — the author travels here, never as a second cluster on the row.
 */
export function identityTooltip(identity: TaskIdentity, author: TaskIdentity | null): string {
  let text = `${identity.email} · ${ROLE_WORD[identity.role]}`;
  if (identity.deactivated) text += " · deactivated";
  if (author && author.email !== identity.email) text += ` — Added by ${author.email}`;
  return text;
}

/** PRN-14: the read-only reason is WORDS, never a dimmed control alone. */
const READ_ONLY_REASON = "Your role can't edit tasks.";

export function TasksPanel({ leadRef, today, onTaskChanged, canWrite: canWriteProp }: TasksPanelProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useCurrentUser();
  // `??`, not `||`: an explicit `false` from a host must not fall through to the capability.
  const canWrite = canWriteProp ?? me.canDo("work.write");
  /** The viewer's own email — `undefined` until ["me"] resolves. Read once per render. */
  const myEmail = me.data?.email;
  // Namespaces the per-row checkbox DOM id (design F-2's hit-area label needs an id to
  // point `htmlFor` at) so two TasksPanel instances on one page — the gallery renders
  // several — can never collide even if their demo task ids happen to match.
  const panelId = React.useId();
  const key = React.useMemo(() => ["lead-tasks", leadRef], [leadRef]);
  const todayStr = today ?? utcDateString(new Date());

  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ tasks: LeadTask[] }>(`/api/leads/${leadRef}/tasks`) });
  // Stable display order INDEPENDENT of completion. The server sorts `doneAt asc nulls
  // first` (open above done) — great for the My Tasks worklist, but in this in-place panel
  // it means completing a task makes the refetch jump it down under the cursor, so a rapid
  // second click lands on whichever row slid up (owner-reported misfire). Here we order by
  // due date (soonest first, undated last) then creation — both immutable, unlike doneAt —
  // so a completed task strikes through IN PLACE and no row ever moves on a toggle.
  const tasks = React.useMemo(() => {
    const list = q.data?.tasks ?? [];
    return [...list].sort((a, b) => {
      if (a.dueOn !== b.dueOn) {
        if (!a.dueOn) return 1;
        if (!b.dueOn) return -1;
        return a.dueOn < b.dueOn ? -1 : 1;
      }
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
  }, [q.data?.tasks]);
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
        {/* WP-UX-7 (audit 3.1): one section-header treatment across the dialog (Lead score /
            Tasks / Timeline) — amber ink is reserved for links + actions, not headings. */}
        <h3 className="text-step-1 font-semibold uppercase tracking-wide text-text-2">Tasks</h3>
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
            const identity = taskIdentity(t);
            // C-11 / C-10: Delete is author-only server-side (an indistinguishable 404), so
            // an authorship miss HIDES the affordance rather than disabling it — a per-row,
            // non-actionable fact, and the click was a guaranteed rejection. The CAPABILITY
            // miss is different: it disables the whole panel with a stated reason (§6
            // disable-don't-hide). The `myEmail !== undefined` guard is load-bearing: while
            // ["me"] is loading BOTH sides are undefined, and a bare `===` would read an
            // authorless row as the viewer's own and reveal a guaranteed-404 Delete.
            const ownOpenTask = !t.doneAt && myEmail !== undefined && t.author?.email === myEmail;
            return (
              <li key={t.id} className="flex items-start gap-2 border-t border-border-soft first:border-t-0">
                {/* Design F-2 (WP-N floor): a 44x44 hit area around the 16px visual box —
                    a native `<label for>` targeting the Checkbox's underlying button, so no
                    extra click-handling is needed; the visual box itself stays desktop-dense. */}
                <label
                  htmlFor={checkboxId}
                  className={cn(
                    "-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-md",
                    canWrite ? "cursor-pointer" : "cursor-not-allowed",
                  )}
                >
                  {/* a11y F-2: the Tooltip wraps the CONTROL, not the label, so its bubble id
                      is cloned onto the element a screen reader actually focuses. */}
                  <MaybeTooltip content={canWrite ? null : READ_ONLY_REASON}>
                    <Checkbox
                      id={checkboxId}
                      checked={Boolean(t.doneAt)}
                      onCheckedChange={() => toggle.mutate(t)}
                      // a11y F-1: the standing permission miss is aria-disabled (focusable, so
                      // the reason is reachable by keyboard); only the transient in-flight
                      // states use native `disabled`.
                      disabled={isToggling || isDeleting}
                      ariaDisabled={!canWrite}
                      ariaLabel={t.doneAt ? `Reopen "${t.title}"` : `Mark "${t.title}" done`}
                    />
                  </MaybeTooltip>
                </label>
                <div className="min-w-0 flex-1 py-2.5">
                  <div className={cn("text-sm font-medium text-text", t.doneAt && "text-text-3 line-through")}>{t.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <DueChip dueOn={t.dueOn} doneAt={t.doneAt} today={todayStr} />
                    {ownOpenTask &&
                      canWrite &&
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
                    {/* C-11: ONE identity per row, right-aligned in the meta row that
                        already exists — the row height is unchanged and the title keeps its
                        full width. Both-null renders nothing at all (never a placeholder
                        glyph: this panel does not invent identity). PRN-14: the identity is
                        the TEXT beside the circle, never the circle itself. */}
                    {identity && (
                      <Tooltip content={identityTooltip(identity, t.author)}>
                        <span
                          tabIndex={0}
                          className="ml-auto inline-flex min-w-0 items-center gap-1.5 rounded text-xs text-text-3 outline-none transition-colors hover:text-text-2 focus-visible:ring-1 focus-visible:ring-brand-ink"
                        >
                          <AvatarInitials email={identity.email} size="xs" />
                          <span className="max-w-[16ch] truncate">
                            {myEmail === identity.email ? "You" : identity.email}
                          </span>
                        </span>
                      </Tooltip>
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
        <MaybeTooltip content={canWrite ? null : READ_ONLY_REASON}>
          {/* a11y F-1: aria-disabled, NOT the native attribute — a natively disabled button
              leaves the tab order, so the tooltip explaining WHY would never be reachable by
              keyboard. The click is swallowed instead, and Tooltip clones aria-describedby
              straight onto this button. */}
          <button
            ref={addTriggerRef}
            type="button"
            onClick={() => {
              if (!canWrite) return;
              setAdding(true);
            }}
            aria-disabled={!canWrite || undefined}
            className={cn(
              "mt-2.5 flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-left text-sm text-text-3 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-brand-ink",
              canWrite ? "hover:border-brand-line hover:text-text-2" : "cursor-not-allowed opacity-50",
            )}
          >
            <span className="text-base leading-none text-brand-ink" aria-hidden="true">
              +
            </span>
            Add a task
          </button>
        </MaybeTooltip>
      ))}
    </div>
  );
}

/** Wrap `children` in a Tooltip only when there is something to say. Keeps the read-only
 *  reason attached to the disabled control without adding a wrapper (and an extra DOM
 *  node) on the far more common writable path. */
function MaybeTooltip({ content, children }: { content: string | null; children: React.ReactElement }) {
  return content ? <Tooltip content={content}>{children}</Tooltip> : children;
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
