"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { Card, CardBody, Switch, Input, Button, Stat, EmptyState, Skeleton, useToast } from "@/components";

// WP-AI-2 Task 10 (SET-11 / BIL-04): admin-only controls for the in-app AI assistant —
// enable/disable, a monthly USD allowance, and month-to-date spend. This is the ONLY
// place dollar figures appear anywhere in the product; the assistant widget itself
// never shows $ (PRN-15: the number is read straight from the API, never re-derived).

interface AiSettingsPayload {
  settings: { enabled: boolean; capUsd: number };
  usage: { spentMicroUsd: number; spentUsd: number };
}

export function AiSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["settings", "ai"], queryFn: () => apiGet<AiSettingsPayload>("/api/settings/ai") });

  // Seed the editable draft from server data WITHOUT setState-in-effect
  // (react-hooks/set-state-in-effect) — adjust state during render instead (WS-7/WP-029).
  const [seed, setSeed] = React.useState<AiSettingsPayload["settings"] | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [cap, setCap] = React.useState("10");
  if (q.data && q.data.settings !== seed) {
    setSeed(q.data.settings);
    setEnabled(q.data.settings.enabled);
    setCap(String(q.data.settings.capUsd));
  }

  const save = useMutation({
    mutationFn: () => apiMutate("/api/settings/ai", "PUT", { enabled, capUsd: Number(cap) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "ai"] });
      toast("AI settings saved.", "success");
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) return <EmptyState title="Couldn’t load AI settings" description="Refresh to try again." />;

  const capNum = Number(cap);
  const capValid = Number.isFinite(capNum) && capNum > 0 && capNum <= 1000;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-text">Assistant enabled</span>
              <span className="block text-step-1 text-text-2">Show the in-app assistant to admins in this workspace.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} ariaLabel="Assistant enabled" />
          </label>

          <Input
            label="Monthly allowance (USD)"
            type="number"
            min={1}
            max={1000}
            step={1}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            error={!capValid ? "Enter a whole-dollar amount between $1 and $1,000." : undefined}
            hint={capValid ? "The assistant stops answering for the rest of the month once this is reached." : undefined}
            className="max-w-[160px]"
          />

          <Stat label="Used this month" value={`$${q.data.usage.spentUsd.toFixed(2)}`} />

          <div>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!capValid}>
              Save changes
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
