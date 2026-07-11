"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as RadixSelect from "@radix-ui/react-select";
import { csrfHeaders } from "@/lib/csrf-client";
import { SEED_LEAD_STATUSES } from "@/modules/portal/statuses";
import { Badge } from "./Badge";
import { useToast } from "./Toast";
import { cn } from "@/lib/cn";

// StatusSelect — the inline lead-status control (WS-3). Radix Select styled as the colored
// status pill; optimistic with error-toast + revert. Removed leads are read-only (PRN-04):
// they render the verdict badge, never a control. No raw <select> (F-58 spirit).

export const STATUS_PILL: Record<string, string> = {
  New: "bg-surface-3 text-text-2",
  Contacted: "bg-brand-soft text-brand-ink",
  Appointment: "bg-warn-soft text-warn",
  "Under contract": "bg-prev-soft text-prev",
  Closed: "bg-success-soft text-success",
  Dead: "bg-danger-soft text-danger",
};

export interface StatusSelectProps {
  refId: string;
  status: string;
  mlsStatus: "kept" | "removed";
  /** Currently unconsumed — a forward-looking hook for WS-4/5 rows (unmatched/partner). */
  onChanged?: (status: string) => void;
}

export function StatusSelect({ refId, status, mlsStatus, onChanged }: StatusSelectProps) {
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
      const res = await fetch(`/api/leads/${refId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ status: next }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Status update failed.");
      return b as { status: string };
    },
    onMutate: (next: string) => {
      const prev = val;
      setVal(next);
      return { prev };
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["lead", refId] });
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
        className={cn(
          "num inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold outline-none",
          "focus-visible:ring-2 focus-visible:ring-brand-line disabled:opacity-60",
          STATUS_PILL[val] ?? "bg-surface-3 text-text-2",
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
            {SEED_LEAD_STATUSES.map((s) => (
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
