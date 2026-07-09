"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, CardHeader, CardTitle, Button, Skeleton, EmptyState, ToastProvider, useToast, AppShell } from "@/components";

// SET-03 / NTF-05: the admin sets, per role + event, whether it emails, shows in-app,
// or both. Transactional auth email is separate and always on.

interface Channel {
  email: boolean;
  inApp: boolean;
}
interface EventDef {
  role: "admin" | "partner";
  key: string;
  label: string;
}
type Prefs = Record<string, Record<string, Channel>>;

function SettingsInner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["notif-prefs"],
    queryFn: () => apiGet<{ prefs: Prefs; events: EventDef[] }>("/api/settings/notifications"),
  });
  // Seed the editable draft from server prefs the first time (and if they change),
  // adjusting state during render — the React-recommended alternative to an effect.
  const [draft, setDraft] = React.useState<Prefs | null>(null);
  const [seededFrom, setSeededFrom] = React.useState<Prefs | null>(null);
  if (data?.prefs && data.prefs !== seededFrom) {
    setSeededFrom(data.prefs);
    setDraft(structuredClone(data.prefs));
  }

  const save = useMutation({
    mutationFn: async (prefs: Prefs) => {
      const res = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Save failed.");
    },
    onSuccess: () => {
      // ADR-0008 / F-79: refetch the server prefs so the draft re-seeds from truth.
      queryClient.invalidateQueries({ queryKey: ["notif-prefs"] });
      toast("Preferences saved.", "success");
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  const toggle = (role: string, key: string, channel: keyof Channel) =>
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      next[role] ??= {};
      next[role][key] ??= { email: false, inApp: false };
      next[role][key][channel] = !next[role][key][channel];
      return next;
    });

  const events = data?.events ?? [];

  return (
    <AppShell>
        <div className="mx-auto max-w-[760px]">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Notification settings</h1>
          <p className="mt-1 text-sm text-text-2">Choose how each alert is delivered. Security emails (sign-in codes, resets) are always sent.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Per-event delivery</CardTitle>
          </CardHeader>
          <CardBody>
            {error ? (
              <EmptyState title="Couldn't load settings" description={(error as Error).message} />
            ) : isPending || !draft ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border-soft pb-2 text-xs font-semibold text-text-3">
                  <span>Event</span>
                  <span className="w-16 text-center">Email</span>
                  <span className="w-16 text-center">In-app</span>
                </div>
                {events.map((ev) => {
                  const ch = draft[ev.role]?.[ev.key] ?? { email: false, inApp: false };
                  return (
                    <div key={`${ev.role}.${ev.key}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5">
                      <div>
                        <p className="text-sm text-text">{ev.label}</p>
                        <p className="text-xs text-text-3 capitalize">{ev.role}</p>
                      </div>
                      <label className="flex w-16 justify-center">
                        <input type="checkbox" checked={ch.email} onChange={() => toggle(ev.role, ev.key, "email")} className="h-4 w-4 accent-brand" aria-label={`Email ${ev.label}`} />
                      </label>
                      <label className="flex w-16 justify-center">
                        <input type="checkbox" checked={ch.inApp} onChange={() => toggle(ev.role, ev.key, "inApp")} className="h-4 w-4 accent-brand" aria-label={`In-app ${ev.label}`} />
                      </label>
                    </div>
                  );
                })}
                <div className="mt-4 flex justify-end">
                  <Button variant="primary" loading={save.isPending} onClick={() => draft && save.mutate(draft)}>
                    Save preferences
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
        </div>
    </AppShell>
  );
}

export default function NotificationSettingsPage() {
  return (
    <ToastProvider>
      <SettingsInner />
    </ToastProvider>
  );
}
