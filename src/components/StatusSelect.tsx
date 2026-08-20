"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as RadixSelect from "@radix-ui/react-select";
import { csrfHeaders } from "@/lib/csrf-client";
import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";
import { cn } from "@/lib/cn";
import { Badge } from "./Badge";
import { useToast } from "./Toast";
import { statusDotClass, statusPillClass } from "@/lib/status-pill";

// StatusSelect — the inline lead-status control (WS-3). Radix Select styled as the colored
// status pill; optimistic with error-toast + revert. Removed leads are read-only (PRN-04):
// they render the verdict badge, never a control. No raw <select> (F-58 spirit).
// The pill vocabulary lives in @/lib/status-pill (statusPillClass), shared with the portal.

/**
 * N5E-04 — the chrome a LABELLED RECORD CONTROL wears, shared verbatim by the lead record's
 * two live controls so they read as one row of the same thing (the owner's hands-on pass found
 * two chips of different shapes floating above the grid). Exported rather than copied because
 * "the same" is the entire requirement: the partner Select gets this string too, appended after
 * the Select primitive's own trigger classes, where it wins.
 *
 * It carries only what has to be ADDED to a Select trigger — full width in its cell, the
 * pointer, and the §6.17 hover/pressed steps a bare trigger does not have. The resting chrome
 * (rounded-md, border-soft, 14px medium, px-3/py-2 → a 38px box) is the Select primitive's own,
 * which the field-variant StatusSelect below reproduces exactly. Nothing here OVERRIDES a base
 * class: there is no tailwind-merge in this codebase (see lib/cn), so a conflicting pair would
 * be settled by stylesheet order rather than by the call site.
 */
export const RECORD_CONTROL_CLASS = cn(
  "w-full cursor-pointer transition-colors hover:bg-surface-2 active:bg-surface-3",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export interface StatusSelectProps {
  refId: string;
  status: string;
  mlsStatus: "kept" | "removed";
  /** VP-3: "admin" (default) posts to /api/leads and refreshes the admin caches; "portal"
   *  posts to /api/portal/leads and refreshes the partner caches. Same pill UI either way. */
  scope?: "admin" | "portal";
  /**
   * N5-06: the statuses this record offers, when the caller already holds the server's list
   * (the lead detail's `availableStatuses`). Defaults to the seeded set — which is what that
   * payload carries today, so the two agree by construction rather than by luck.
   */
  statuses?: readonly string[];
  /**
   * N5E-03: the trigger's SHAPE, and nothing else — same Radix root, same optimistic write,
   * same options, same removed-lead badge.
   *  - "pill" (default): the colored status pill. Right for a table cell and for the leads
   *    board, where the control has to read as the row's status at a glance.
   *  - "field": a labelled record field's control — one 36px full-width bordered box with a
   *    caret, so it and the partner Select beside it share one chrome instead of being two
   *    floating chips of different shapes (owner hands-on round). The status hue survives as
   *    the leading dot, which never travels alone: the status WORD is right beside it (PRN-14).
   */
  variant?: "pill" | "field";
  /** Currently unconsumed — a forward-looking hook for WS-4/5 rows (unmatched/partner). */
  onChanged?: (status: string) => void;
}

export function StatusSelect({ refId, status, mlsStatus, scope = "admin", statuses = SEED_LEAD_STATUSES, variant = "pill", onChanged }: StatusSelectProps) {
  const qc = useQueryClient();
  const toast = useToast();

  // Optimistic local value; re-seed when the server row changes (ADR-0008).
  const [val, setVal] = React.useState(status);
  const [seeded, setSeeded] = React.useState(status);
  if (status !== seeded) {
    setSeeded(status);
    setVal(status);
  }

  const mut = useMutation({
    mutationFn: async (next: string) => {
      const url = scope === "portal" ? `/api/portal/leads/${refId}/status` : `/api/leads/${refId}/status`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ status: next }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error((b as { message?: string } | null)?.message ?? "Status update failed.");
      return { status: (b as { status?: string } | null)?.status ?? next };
    },
    onMutate: (next: string) => {
      const prev = val;
      setVal(next);
      return { prev };
    },
    onSuccess: (b) => {
      if (scope === "portal") {
        // A plain queryKey filter is element-wise, so ["portal-leads"] does NOT match the
        // desktop table's ["portal-leads-desktop", …]; a first-segment predicate refreshes
        // the table, mobile list, dialog, and the nav-badge "New" count together (F-1).
        qc.invalidateQueries({ queryKey: ["portal-lead", refId] });
        qc.invalidateQueries({
          predicate: (query) => typeof query.queryKey[0] === "string" && (query.queryKey[0] as string).startsWith("portal-leads"),
        });
      } else {
        qc.invalidateQueries({ queryKey: ["leads"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        qc.invalidateQueries({ queryKey: ["lead", refId] });
      }
      toast.toast(`Status → ${b.status}`, "success");
      onChanged?.(b.status);
    },
    onError: (e: Error, _next, ctx) => {
      setVal((ctx as { prev: string })?.prev ?? status);
      toast.toast(e.message, "danger");
    },
  });

  if (mlsStatus === "removed") return <Badge variant="removed">Removed · MLS</Badge>;

  const field = variant === "field";
  return (
    <RadixSelect.Root value={val} onValueChange={(v) => mut.mutate(v)} disabled={mut.isPending}>
      <RadixSelect.Trigger
        aria-label={`Status for ${refId}`}
        className={
          field
            ? cn(
                // The Select primitive's trigger anatomy, reproduced so the partner control
                // beside it is a twin rather than a lookalike; RECORD_CONTROL_CLASS is the
                // half both of them add on top.
                //
                // Reproduced VERBATIM — `justify-between` (which pushes the caret to the far
                // edge rather than leaving it wherever the status word ends) and the
                // border-color transition were both missed by the first hand-copy, and the
                // two controls sat side by side with a caret in different places and one of
                // them snapping its focus border. The chrome-parity test in
                // tests/unit/lead-record-polish.test.tsx now compares the two triggers' FULL
                // class sets, so the next omission fails rather than ships.
                // (`w-full` is not repeated here: RECORD_CONTROL_CLASS below carries it, and
                // that is the half both controls share.)
                "inline-flex items-center justify-between gap-2 rounded-md border border-border-soft bg-surface px-3 py-2 text-sm font-medium text-text-2",
                "outline-none transition-[border-color] duration-[120ms] focus-visible:border-brand-ink focus-visible:ring-1 focus-visible:ring-brand-ink",
                RECORD_CONTROL_CLASS,
              )
            : statusPillClass(
                val,
                "cursor-pointer gap-1 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink disabled:opacity-60",
              )
        }
      >
        {field ? (
          // ONE flex child, not two. `justify-between` distributes the free space BETWEEN the
          // trigger's children, so a bare dot + Value would be pushed apart by it — and PRN-14
          // is the requirement that the hue never travels without the word right beside it.
          // Grouping them also makes the trigger a two-child box like the Select primitive's,
          // which is what the shared `justify-between` was copied for.
          <span className="flex min-w-0 items-center gap-2">
            {/* PRN-14: decorative only — the status word sits immediately beside it. */}
            <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", statusDotClass(val))} />
            <RadixSelect.Value />
          </span>
        ) : (
          <RadixSelect.Value />
        )}
        {/* No `ms-auto`: `justify-between` on the trigger is what puts the caret at the far
            edge, exactly as it does on the Select primitive this variant mirrors. */}
        <RadixSelect.Icon className={field ? "text-text-3" : undefined}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content position="popper" sideOffset={4} className="anim-pop z-[130] overflow-hidden rounded-md border border-border bg-surface shadow-md">
          <RadixSelect.Viewport className="p-1">
            {statuses.map((s) => (
              <RadixSelect.Item key={s} value={s} className="relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 pr-7 text-sm text-text outline-none data-[highlighted]:bg-brand-soft data-[highlighted]:text-brand-ink">
                <RadixSelect.ItemText>{s}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2 text-brand-ink">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
