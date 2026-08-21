"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ApiError, apiDownload, apiGet, apiMutate } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useTags } from "@/lib/tags-client";
import { useCurrentUser } from "@/lib/use-current-user";
import { describeFilters } from "@/modules/leads/filter-describe";
import { bulkFilterBody, type LeadsFilterState } from "@/modules/leads/filter-wire";
import { BULK_SKIPPED_REFS_MAX, type BulkSelection } from "@/modules/leads/schema";
import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";
import {
  Button, Combobox, Dialog, RadioGroup, RadioGroupItem, SegmentedControl, Skeleton, TagChip, useToast,
} from "@/components";
import { NEW_OWNER_CONSEQUENCE } from "./transfer-copy";

// ─────────────────────────────────────────────────────────────────────────────
// WP-N6 (N6-53..56) — the leads list's selection bar and its three confirm dialogs.
//
// The honesty rule runs through all of it: every number an operator reads before committing
// comes from the SERVER's dry run (N6-05), not from counting checkboxes. That matters most in
// the escalated mode, where the selection is a filter rather than a list — "Assign 641 leads"
// has to be the count the write will actually touch, skips already deducted.
// ─────────────────────────────────────────────────────────────────────────────

interface Partner { id: string; refId: string; name: string; color: string }

interface BulkSplit {
  total: number;
  skipped: Record<string, number>;
}
interface BulkDryRun extends BulkSplit {
  dryRun: true;
  eligible: number;
}
interface BulkApplied extends BulkSplit {
  dryRun: false;
  applied: number;
  skippedRefs: { ref: string; reason: string }[];
}

/** Operator-facing names for the server's skip reasons (N6-55). A reason with no entry falls
 *  back to its key rather than vanishing — an unnamed skip is still a reported skip. */
const SKIP_LABELS: Record<string, string> = {
  notFound: "No longer in this workspace",
  removedMls: "Removed from MLS",
  alreadyAssigned: "Already with that partner",
  alreadyAtStatus: "Already at that status",
  alreadyTagged: "Already has that tag",
  notTagged: "Didn't have that tag",
};

/** Toasts raised here are scoped to the bar so they leave with it (Toast `dismissScope`) —
 *  a "View skipped" action outliving its dialog host would be a live-looking dead button. */
const TOAST_SCOPE = "leads-bulk";

const sumSkipped = (s: Record<string, number>) => Object.values(s).reduce((a, b) => a + b, 0);

export interface BulkBarProps {
  /** The COMMITTED filters — the same values the list query serialized to produce `total`. */
  filters: LeadsFilterState;
  /** The list query's `total`: how many leads the current filter matches workspace-wide. */
  total: number;
  selected: ReadonlySet<string>;
  allMatching: boolean;
  onEscalate: () => void;
  onClear: () => void;
  /** A run committed: the caller drops the selection and refreshes the affected surfaces. */
  onApplied: () => void;
}

type BulkAction = "assign" | "status" | "tags" | "export";

/** What a dialog is acting on, FROZEN at the moment it opened (audit-ux-flows F-5). Reading
 *  the live selection while a dialog is up means a background refetch, a row un-ticked behind
 *  the scrim, or a filter change can silently retarget a confirmed action — the operator would
 *  approve "596 leads" and something else would run. */
interface PendingAction {
  action: BulkAction;
  selection: BulkSelection;
  count: number;
}

export function BulkBar({ filters, total, selected, allMatching, onEscalate, onClear, onApplied }: BulkBarProps) {
  const { canDo } = useCurrentUser();
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [skippedView, setSkippedView] = React.useState<{ skipped: Record<string, number>; refs: BulkApplied["skippedRefs"] } | null>(null);
  const { toast, dismissScope } = useToast();
  const qc = useQueryClient();

  const roster = useQuery({ queryKey: ["partners"], queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners") });
  const tagsQ = useTags();

  React.useEffect(() => () => dismissScope(TOAST_SCOPE), [dismissScope]);

  const count = allMatching ? total : selected.size;

  const words = describeFilters(filters, {
    partners: new Map((roster.data?.partners ?? []).map((p) => [p.id, `${p.name} (${p.refId})`])),
    tags: new Map((tagsQ.data?.tags ?? []).map((t) => [t.id, t.name])),
  });

  const openAction = (action: BulkAction) =>
    setPending({
      action,
      count,
      // N6-50: escalated mode carries NO id list — the filter travels instead, and the server
      // re-resolves it through the same predicate the list count came from. The cast is the
      // client/server seam: `bulkFilterBody` produces the wire shape and `BulkSelectionSchema`
      // is what actually decides whether it is valid, at the boundary (N6-02).
      selection: (allMatching
        ? { mode: "filter", filters: bulkFilterBody(filters) }
        : { mode: "refs", leadRefs: [...selected] }) as BulkSelection,
    });

  /** N6-55: one place that turns a completed run into the toast + the refresh. */
  const report = React.useCallback(
    (verb: string, res: BulkApplied) => {
      const missed = sumSkipped(res.skipped);
      const message = missed > 0 ? `${verb} ${res.applied} · skipped ${missed}` : `${verb} ${res.applied}`;
      toast(
        message,
        "success",
        missed > 0 && res.skippedRefs.length > 0
          ? { label: "View skipped", onClick: () => setSkippedView({ skipped: res.skipped, refs: res.skippedRefs }) }
          : undefined,
        TOAST_SCOPE,
      );
      // Everything a bulk write can have moved: the list + its nav counts (one prefix), the
      // board, the tag roster's usage counts, and an open record's own panel.
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["leads-board"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      setPending(null);
      onApplied();
    },
    [toast, qc, onApplied],
  );

  const fail = React.useCallback(
    (e: unknown) => {
      // The uniform envelope's message, scoped — and the selection is deliberately KEPT so
      // the operator can retry without rebuilding it.
      toast(e instanceof ApiError ? e.message : "Something went wrong.", "danger", undefined, TOAST_SCOPE);
    },
    [toast],
  );

  // N6-53: per-action capability gating. An action the seat lacks is ABSENT, not disabled —
  // a disabled control advertises a capability the seat will never have. The two gates are
  // INDEPENDENT: `data.export` is an egress capability and `leads.write` a mutation one, and a
  // seat can hold either without the other (a read-only analyst exports; a member edits).
  const canWrite = canDo("leads.write");
  const canExport = canDo("data.export");

  // N6-55: an empty selection hides the BAR, never this whole component. A successful run
  // clears the selection, and if that unmounted the subtree it would take the result toast
  // (scoped here) and the "View skipped" dialog with it — the two things the operator needs
  // precisely BECAUSE the run finished.
  // A11Y-03: the live region is PERMANENTLY mounted, outside the conditional bar. A region
  // that appears at the same moment as its first message is not announced by most screen
  // readers — the 0→1 transition, the one that tells a keyboard user their tick registered,
  // was silent. The visible bar therefore carries no aria-live of its own; this is the
  // announcement, and it is text-only (PRN-14 — never the tint).
  const announcement =
    count === 0
      ? ""
      : allMatching
        ? `${total.toLocaleString()} ${total === 1 ? "lead" : "leads"} selected — everything matching ${words || "the current view"}`
        : `${selected.size.toLocaleString()} selected on this page`;

  return (
    <>
      {/* Named, because the app already has a second `role="status"` region (the toast
          announcer) — an unnamed one leaves AT users, and anything querying by role, unable to
          tell which is speaking. */}
      <p className="sr-only" role="status" aria-live="polite" aria-label="Selection status">{announcement}</p>
      {count > 0 && (
      <div
        // A named group: the bar appears and disappears with the selection, so AT users
        // arriving at these controls get told what they belong to rather than meeting three
        // unexplained buttons between the count row and the table.
        role="group"
        aria-label="Selection actions"
        className={cn(
          "mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border px-3 py-2",
          // Escalated selections re-tint: the bar is the only thing on screen that knows the
          // selection reaches beyond the visible page, so it has to look different.
          allMatching ? "border-brand-line bg-brand-soft" : "border-border bg-surface-2",
        )}
      >
        {/* PRN-14: the count is TEXT. The row wash and the bar tint are reinforcement — never
            the only carrier of "how much is selected". Announced by the sr-only region above,
            not from here (see A11Y-03 note). */}
        <p className="text-sm text-text">
          {allMatching ? (
            <>
              <span className="num font-semibold">{total.toLocaleString()}</span>{" "}
              {total === 1 ? "lead" : "leads"} selected — everything matching {words ? <span className="font-semibold">{words}</span> : "the current view"}
            </>
          ) : (
            <>
              <span className="num font-semibold">{selected.size.toLocaleString()}</span> selected on this page
              {total > selected.size && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={onEscalate}
                    className="rounded-sm font-semibold text-brand-ink underline-offset-2 outline-none transition-colors hover:underline focus-visible:ring-1 focus-visible:ring-brand-ink active:opacity-80"
                  >
                    Select all {total.toLocaleString()} matching this filter
                  </button>
                </>
              )}
            </>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <Button size="sm" onClick={() => openAction("status")}>Status…</Button>
              <Button size="sm" onClick={() => openAction("tags")}>Tags…</Button>
              <Button size="sm" variant="primary" onClick={() => openAction("assign")}>Assign…</Button>
            </>
          )}
          {canExport && <Button size="sm" onClick={() => openAction("export")}>Export…</Button>}
          {(canWrite || canExport) && <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />}
          <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
        </div>
      </div>
      )}

      {pending?.action === "assign" && (
        <AssignDialog
          selection={pending.selection}
          count={pending.count}
          roster={roster}
          onClose={() => setPending(null)}
          onDone={(res) => report("Assigned", res)}
          onError={fail}
        />
      )}
      {pending?.action === "status" && (
        <StatusDialog
          selection={pending.selection}
          count={pending.count}
          onClose={() => setPending(null)}
          onDone={(res) => report("Updated", res)}
          onError={fail}
        />
      )}
      {pending?.action === "tags" && (
        <TagsDialog
          selection={pending.selection}
          count={pending.count}
          tagsQ={tagsQ}
          onClose={() => setPending(null)}
          onDone={(res) => report("Tagged", res)}
          onError={fail}
        />
      )}
      {pending?.action === "export" && (
        <ExportDialog
          selection={pending.selection}
          count={pending.count}
          onClose={() => setPending(null)}
          onDone={() => {
            // N6-55's "selection clears on success" is a MUTATION rule: it exists because the
            // rows the operator selected are no longer in the state they selected them in. An
            // export changes nothing, and "export, then assign the same set" is the obvious
            // next gesture — so the selection stays.
            toast("Export downloaded", "success", undefined, TOAST_SCOPE);
            setPending(null);
          }}
          onError={fail}
        />
      )}
      {skippedView && <SkippedDialog rows={skippedView.refs} counts={skippedView.skipped} onClose={() => setSkippedView(null)} />}
    </>
  );
}

// ── The dry-run seam ──────────────────────────────────────────────────────────

/**
 * N6-05 — resolve the split server-side with ZERO writes. A POST behind `useQuery` reads
 * oddly at first glance and is deliberate: `dryRun` is a READ that happens to need a body, so
 * it belongs in the query cache's request lifecycle (loading/error/retry) rather than in a
 * mutation. `body === null` (nothing chosen yet) keeps it disabled.
 */
function useDryRun(url: string, body: Record<string, unknown> | null) {
  return useQuery({
    queryKey: ["bulk-dry-run", url, JSON.stringify(body)],
    queryFn: () => apiMutate<BulkDryRun>(url, "POST", { ...body, dryRun: true }),
    enabled: body !== null,
    // Never reuse a resolution: the set it describes can change under the operator, and a
    // stale count is exactly the promise this endpoint exists to avoid making.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** A failed async read inside a dialog, with the one action that can recover it. The dialogs
 *  are modal, so a dead end here is a dead end for the whole flow (audit-ux-flows F-1/F-6). */
function InlineRetry({ message, onRetry, busy }: { message: string; onRetry: () => void; busy?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger bg-surface-2 px-3 py-2.5">
      <p className="text-sm text-danger">{message}</p>
      <Button size="sm" onClick={onRetry} loading={busy}>Retry</Button>
    </div>
  );
}

/** The split, rendered. One component so the three dialogs cannot describe it differently. */
function SplitSummary({ query, noun }: { query: ReturnType<typeof useDryRun>; noun: string }) {
  if (query.isPending) return <Skeleton className="h-16 w-full" />;
  if (query.error) {
    return (
      <InlineRetry
        message={query.error instanceof ApiError ? query.error.message : "Couldn't work out what this would change."}
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      />
    );
  }
  const d = query.data!;
  const entries = Object.entries(d.skipped).filter(([, n]) => n > 0);
  return (
    <dl className="rounded-lg border border-border-soft bg-surface-2 px-3 py-2.5 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-text-3">Selected</dt>
        <dd className="num font-semibold text-text-2">{d.total.toLocaleString()}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-text-3">Will {noun}</dt>
        <dd className="num font-semibold text-text">{d.eligible.toLocaleString()}</dd>
      </div>
      {entries.map(([reason, n]) => (
        <div key={reason} className="flex items-baseline justify-between gap-3">
          <dt className="text-text-3">Skipped — {SKIP_LABELS[reason] ?? reason}</dt>
          <dd className="num text-text-2">{n.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

interface DialogShared {
  selection: BulkSelection;
  count: number;
  onClose: () => void;
  onDone: (res: BulkApplied) => void;
  onError: (e: unknown) => void;
}

/**
 * The confirm button's label. `eligible` is 0 both before the server has answered AND when the
 * server says nothing qualifies — either way the bare verb is the honest label, because
 * "Assign 0 leads" names an action the disabled button will never perform
 * (audit-ux-flows F-7). Only a resolved, non-zero count earns a number.
 */
function confirmLabel(q: ReturnType<typeof useDryRun>, verb: string, noun = "lead"): string {
  const n = q.data?.eligible ?? 0;
  if (q.isPending || q.error || n === 0) return verb;
  return `${verb} ${n.toLocaleString()} ${n === 1 ? noun : `${noun}s`}`;
}

const eligibleOf = (q: ReturnType<typeof useDryRun>) => q.data?.eligible ?? 0;

// ── Assign (N6-14): destination → server-resolved confirm ─────────────────────

function AssignDialog({
  selection, count, roster, onClose, onDone, onError,
}: DialogShared & { roster: UseQueryResult<{ partners: Partner[] }, Error> }) {
  const [partnerId, setPartnerId] = React.useState("");
  const [step, setStep] = React.useState<"pick" | "confirm">("pick");
  const body = step === "confirm" && partnerId ? { selection, partnerId } : null;
  const dry = useDryRun("/api/leads/bulk/assign", body);
  const run = useMutation({
    mutationFn: () => apiMutate<BulkApplied>("/api/leads/bulk/assign", "POST", { selection, partnerId }),
    onSuccess: onDone,
    onError,
  });
  const partners = roster.data?.partners ?? [];
  const dest = partners.find((p) => p.id === partnerId);
  const eligible = eligibleOf(dry);

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      // audit-ux-flows F-3: while the write is in flight, Esc and a backdrop click raise the
      // discard guard instead of closing. Dismissing mid-run wouldn't cancel anything — the
      // request is already with the server — it would just hide the outcome.
      confirmClose={run.isPending}
      title={step === "pick" ? "Assign selected leads" : "Reassign these leads?"}
      footer={
        step === "pick" ? (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!partnerId} onClick={() => setStep("confirm")}>Continue</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("pick")}>Back</Button>
            <Button
              variant="danger"
              loading={run.isPending}
              disabled={dry.isPending || Boolean(dry.error) || eligible === 0}
              onClick={() => run.mutate()}
            >
              {confirmLabel(dry, "Assign")}
            </Button>
          </>
        )
      }
    >
      {step === "pick" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-2">
            <span className="num font-semibold">{count.toLocaleString()}</span> {count === 1 ? "lead is" : "leads are"} selected. Choose where they should go.
          </p>
          {/* audit-ux-flows F-1: the roster has three states, and a failed fetch used to render
              as an empty picker — "there are no partners" is a different, wrong claim. */}
          {roster.isPending ? (
            <Skeleton className="h-9 w-full" />
          ) : roster.error ? (
            <InlineRetry message="Couldn't load the partner list." onRetry={() => roster.refetch()} busy={roster.isFetching} />
          ) : (
            /* PRN-14: name AND reference id, never a colour alone. */
            <Combobox
              ariaLabel="Assign to partner"
              placeholder="Choose a partner…"
              value={partnerId}
              onValueChange={setPartnerId}
              options={partners.map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` }))}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-2">
            These leads will move to{" "}
            <span className="font-semibold text-text">{dest ? `${dest.name} (${dest.refId})` : "the selected partner"}</span>.
          </p>
          <SplitSummary query={dry} noun="be assigned" />
          {/* N6-14: the SAME consequence sentence the single-lead transfer states — imported,
              never re-typed (./transfer-copy). */}
          <p className="text-step-1 text-text-3">{NEW_OWNER_CONSEQUENCE}</p>
        </div>
      )}
    </Dialog>
  );
}

// ── Status (N6-20..23) ────────────────────────────────────────────────────────

function StatusDialog({ selection, count, onClose, onDone, onError }: DialogShared) {
  const [status, setStatus] = React.useState("");
  const body = status ? { selection, status } : null;
  const dry = useDryRun("/api/leads/bulk/status", body);
  const run = useMutation({
    mutationFn: () => apiMutate<BulkApplied>("/api/leads/bulk/status", "POST", { selection, status }),
    onSuccess: onDone,
    onError,
  });
  const eligible = eligibleOf(dry);

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      confirmClose={run.isPending}
      title="Set status"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={run.isPending}
            disabled={!status || dry.isPending || Boolean(dry.error) || eligible === 0}
            onClick={() => run.mutate()}
          >
            {status ? confirmLabel(dry, "Update") : "Update"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-2">
          <span className="num font-semibold">{count.toLocaleString()}</span> {count === 1 ? "lead is" : "leads are"} selected.
        </p>
        {/* SEAM-06: the seeded workflow vocabulary. "Removed MLS" is a verdict, not a status,
            so it is not settable here (the server refuses those leads and reports them). */}
        <RadioGroup ariaLabel="New status" value={status} onValueChange={setStatus}>
          {SEED_LEAD_STATUSES.map((s) => (
            <RadioGroupItem key={s} value={s} label={s} />
          ))}
        </RadioGroup>
        {status && <SplitSummary query={dry} noun="change" />}
      </div>
    </Dialog>
  );
}

// ── Tags (N6-30..33) ──────────────────────────────────────────────────────────

function TagsDialog({
  selection, count, tagsQ, onClose, onDone, onError,
}: DialogShared & { tagsQ: UseQueryResult<{ tags: { id: string; name: string; color: string }[] }, Error> }) {
  const tags = tagsQ.data?.tags ?? [];
  const [op, setOp] = React.useState<"add" | "remove">("add");
  const [tagId, setTagId] = React.useState("");
  const body = tagId ? { selection, op, tagId } : null;
  const dry = useDryRun("/api/leads/bulk/tags", body);
  const run = useMutation({
    mutationFn: () => apiMutate<BulkApplied>("/api/leads/bulk/tags", "POST", { selection, op, tagId }),
    onSuccess: onDone,
    onError,
  });
  const eligible = eligibleOf(dry);

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      confirmClose={run.isPending}
      title="Tags"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={run.isPending}
            disabled={!tagId || dry.isPending || Boolean(dry.error) || eligible === 0}
            onClick={() => run.mutate()}
          >
            {tagId ? confirmLabel(dry, op === "add" ? "Add to" : "Remove from") : op === "add" ? "Add to" : "Remove from"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl<"add" | "remove">
          ariaLabel="Tag operation"
          value={op}
          onValueChange={(v) => setOp(v)}
          options={[{ value: "add", label: "Add" }, { value: "remove", label: "Remove" }]}
        />
        <p className="text-sm text-text-2">
          <span className="num font-semibold">{count.toLocaleString()}</span> {count === 1 ? "lead is" : "leads are"} selected.
        </p>
        {/* TAG-05's "Hot" is absent on purpose: it is derived from the score, not a stored tag,
            so there is nothing to attach. Creating a tag stays in the picker / Settings. */}
        {tagsQ.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : tagsQ.error ? (
          /* audit-ux-flows F-1: a failed roster fetch is NOT "no tags yet" — that copy sends
             the operator to Settings to create a tag they may already have. */
          <InlineRetry message="Couldn't load the tag list." onRetry={() => tagsQ.refetch()} busy={tagsQ.isFetching} />
        ) : tags.length === 0 ? (
          <p className="text-sm text-text-3">No tags yet — create one in Settings → Tags.</p>
        ) : (
          /* Honest semantics over an aspirational contract (pr-reviewer F-3 / design F-5):
             this WAS role="radiogroup" + role="radio", which promises the APG radio keyboard
             model — one tab stop, arrow keys to move between options. It has neither. Rather
             than hand-roll roving tabindex in a leaf picker, the chips are what they actually
             are: a group of individually-tabbable toggle buttons reporting `aria-pressed`.
             Every option stays keyboard-reachable and correctly announced, and nothing claims
             behaviour the component does not implement. Promoting RadioGroupItem to accept
             custom content (which would give the real radio model here) is a CANDIDATE. */
          <div role="group" aria-label="Tag" className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tagId === t.id}
                onClick={() => setTagId(t.id)}
                className={cn(
                  "rounded-full outline-none transition-[opacity,box-shadow] focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.98]",
                  tagId === t.id ? "ring-1 ring-brand-ink" : "opacity-70 hover:opacity-100",
                )}
              >
                <TagChip name={t.name} color={t.color} />
              </button>
            ))}
          </div>
        )}
        {tagId && <SplitSummary query={dry} noun={op === "add" ? "be tagged" : "be untagged"} />}
      </div>
    </Dialog>
  );
}

// ── Export (N6-40..44) ────────────────────────────────────────────────────────

/**
 * The one action in the bar that is a READ. No dry run: there is no eligibility to resolve —
 * every selected lead is exportable — so the count shown is the one the bar already holds,
 * which in escalated mode IS the server's (the list query's `total`) and in page mode is the
 * operator's own ticks. A second round trip to re-count a set nothing will change would buy
 * nothing the operator can act on.
 *
 * The dialog exists because the gesture is an EGRESS of seller PII, so it states what leaves,
 * in what shape, and that it is not retained — not because the action needs confirming twice.
 */
function ExportDialog({
  selection, count, onClose, onDone, onError,
}: {
  selection: BulkSelection;
  count: number;
  onClose: () => void;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const run = useMutation({
    mutationFn: () => apiDownload("/api/leads/export", { selection }, "leads-selection.xlsx"),
    onSuccess: onDone,
    onError,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      confirmClose={run.isPending}
      title="Export selected leads"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>Download</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-2">
          <span className="num font-semibold">{count.toLocaleString()}</span> {count === 1 ? "lead" : "leads"} will be exported.
        </p>
        <dl className="rounded-lg border border-border-soft bg-surface-2 px-3 py-2.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-3">Format</dt>
            <dd className="text-text-2">.xlsx — the fixed 18-column layout</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-3">Sheets</dt>
            <dd className="text-text-2">Leads (by partner) · Color legend · Selection summary</dd>
          </div>
        </dl>
        {/* SET-01: the toggle lives in Settings → Data and Export and is read server-side —
            named here so the workbook's appearance is never a surprise. */}
        <p className="text-step-1 text-text-3">
          Color coding follows your workspace setting. Downloads immediately; nothing is stored.
        </p>
      </div>
    </Dialog>
  );
}

// ── "View skipped" (N6-55) ────────────────────────────────────────────────────

/**
 * `rows` is BOUNDED at `BULK_SKIPPED_REFS_MAX` server-side; `counts` is the exact per-reason
 * tally (N6-06). Rendering only the refs would UNDER-REPORT a large run — a group header
 * reading "45" when 4,500 were skipped is a wrong number, not a truncated list
 * (audit-ux-flows F-2). So the header names the true count, and says how many of it are
 * enumerated whenever the two differ.
 */
function SkippedDialog({
  rows, counts, onClose,
}: { rows: BulkApplied["skippedRefs"]; counts: Record<string, number>; onClose: () => void }) {
  const groups = new Map<string, string[]>();
  // Seed from the authoritative counts so a reason whose refs were ALL cut off by the cap
  // still gets a row — otherwise it would vanish from the report entirely.
  for (const reason of Object.keys(counts)) if (counts[reason] > 0) groups.set(reason, []);
  for (const r of rows) {
    const list = groups.get(r.reason);
    if (list) list.push(r.ref);
    else groups.set(r.reason, [r.ref]);
  }
  const capped = rows.length < sumSkipped(counts);
  return (
    <Dialog open onClose={onClose} size="sm" title="Leads that were skipped" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-4">
        {[...groups].map(([reason, refs]) => {
          const trueCount = counts[reason] ?? refs.length;
          return (
            <div key={reason}>
              <p className="mb-1 text-step-1 font-semibold text-text-2">
                {SKIP_LABELS[reason] ?? reason} ·{" "}
                <span className="num">
                  {refs.length < trueCount ? `${refs.length.toLocaleString()} of ${trueCount.toLocaleString()}` : trueCount.toLocaleString()}
                </span>
              </p>
              {/* Selectable text rather than a copy button: the operator usually wants a subset,
                  and a scrollable block keeps a long list from swallowing the dialog. */}
              <p className="num max-h-40 select-text overflow-auto rounded-lg border border-border-soft bg-surface-2 px-2.5 py-2 text-xs leading-relaxed text-text-3">
                {refs.length > 0 ? refs.join(", ") : "—"}
              </p>
            </div>
          );
        })}
        {capped && (
          <p className="text-step-1 text-text-3">
            Showing the first <span className="num">{BULK_SKIPPED_REFS_MAX.toLocaleString()}</span> skipped leads. The counts above are exact.
          </p>
        )}
      </div>
    </Dialog>
  );
}
