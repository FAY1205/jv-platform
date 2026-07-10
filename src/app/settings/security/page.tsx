"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, CardHeader, CardTitle, Button, EmptyState, Skeleton, useToast } from "@/components";
import { SettingsSection } from "../settings-section";

// WS-7e · ACC-02: the admin's own active sessions/devices, each revocable, plus
// "sign out everywhere" (AUT-14 global refresh-token revocation). Reuses GET /api/sessions
// + POST /api/sessions/[familyId]/revoke + POST /api/auth/logout — no new auth surface.

interface Device {
  familyId: string;
  deviceLabel: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default function SecuritySettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  const { data, isPending, error } = useQuery({
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
    onError: (e: Error) => toast(e.message, "danger"),
  });

  async function signOutEverywhere() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ scope: "global" }),
      });
    } catch {
      // Navigate away regardless — tokens are server-revoked.
    }
    qc.clear();
    window.location.assign("/login");
  }

  const devices = data?.devices ?? [];

  return (
    <SettingsSection title="Security" description="Your active sessions and devices.">
      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
        </CardHeader>
        <CardBody>
          {error ? (
            <EmptyState title="Couldn't load sessions" description={(error as Error).message} />
          ) : isPending ? (
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
                    <p className="truncate text-sm text-text">{d.deviceLabel ?? "Unknown device"}</p>
                    <p className="num text-xs text-text-3">
                      last seen {fmt(d.lastSeenAt)} · {d.ip ?? "—"}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={revoke.isPending && revoke.variables === d.familyId}
                    onClick={() => revoke.mutate(d.familyId)}
                  >
                    Sign out
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign out everywhere</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-text-2">Ends every session on all devices, including this one. You will need to sign in again.</p>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-text-2">Sign out of all devices?</span>
              <Button variant="danger" size="sm" loading={signingOut} onClick={signOutEverywhere}>
                Yes, sign out everywhere
              </Button>
              <Button variant="ghost" size="sm" disabled={signingOut} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
              Sign out everywhere
            </Button>
          )}
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
