"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as RadixSelect from "@radix-ui/react-select";
import { csrfHeaders } from "@/lib/csrf-client";
import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";
import { Badge } from "./Badge";
import { useToast } from "./Toast";
import { statusPillClass } from "@/lib/status-pill";

// StatusSelect — the inline lead-status control (WS-3). Radix Select styled as the colored
// status pill; optimistic with error-toast + revert. Removed leads are read-only (PRN-04):
// they render the verdict badge, never a control. No raw <select> (F-58 spirit).
// The pill vocabulary lives in @/lib/status-pill (statusPillClass), shared with the portal.

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
  /** Currently unconsumed — a forward-looking hook for WS-4/5 rows (unmatched/partner). */
  onChanged?: (status: string) => void;
}

export function StatusSelect({ refId, status, mlsStatus, scope = "admin", statuses = SEED_LEAD_STATUSES, onChanged }: StatusSelectProps) {
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

  return (
    <RadixSelect.Root value={val} onValueChange={(v) => mut.mutate(v)} disabled={mut.isPending}>
      <RadixSelect.Trigger
        aria-label={`Status for ${refId}`}
        className={statusPillClass(
          val,
          "cursor-pointer gap-1 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink disabled:opacity-60",
        )}
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
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
