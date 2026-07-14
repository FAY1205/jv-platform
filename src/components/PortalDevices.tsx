"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";

// WP-PW-4 Task 2: the partner's remembered devices, each revocable (ACC-02) — extracted
// VERBATIM from devices/page.tsx so both the standalone /portal/devices route (mobile)
// and the desktop Account right column (account-desktop.tsx) render the exact same
// list/empty/error/loading UI and the exact same revoke behavior (["sessions"]
// invalidation on success). This component renders ONLY the inner content (the device
// list, its states, and the role="alert" error line) — NOT a Card/CardBody/<main> frame
// — so each caller supplies its own framing.
interface Device {
  familyId: string;
  deviceLabel: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function PortalDevices() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => apiGet<{ devices: Device[] }>("/api/sessions"),
  });

  const revoke = useMutation({
    mutationFn: async (familyId: string) => {
      const res = await fetch(`/api/sessions/${familyId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: "{}",
      });
      if (!res.ok) throw new Error("Could not sign out that device.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const devices = data?.devices ?? [];

  return (
    <>
      {error ? (
        <EmptyState title="Couldn't load your devices" description={(error as Error).message} />
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : devices.length === 0 ? (
        <EmptyState title="No remembered devices" description="Devices you choose to remember at sign-in will appear here." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {devices.map((d) => (
            <li key={d.familyId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-text-2">{d.deviceLabel ?? "Unknown device"}</p>
                <p className="num text-step-1 text-text-3">
                  last seen {fmt(d.lastSeenAt)} · {d.ip ?? "—"}
                </p>
              </div>
              <Button
                variant="secondary"
                size="lg"
                loading={revoke.isPending && revoke.variables === d.familyId}
                onClick={() => revoke.mutate(d.familyId)}
                aria-label={`Sign out ${d.deviceLabel ?? "this device"}`}
              >
                Sign out
              </Button>
            </li>
          ))}
        </ul>
      )}
      {revoke.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {(revoke.error as Error).message}
        </p>
      )}
    </>
  );
}
