"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, CardHeader, CardTitle, Button, Checkbox, Skeleton, EmptyState, useToast } from "@/components";
import { SettingsSection } from "../settings-section";

// SET-03 / NTF-05: the admin sets, per role + event, whether it emails, shows in-app,
// or both. Transactional auth email is separate and always on. Hosted under the Settings
// hub (WS-7b); the checkbox UI is rebuilt on the Checkbox primitive in WS-7f.

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

export default function NotificationSettingsPage() {
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
    <SettingsSection title="Notifications" description="Choose how each alert is delivered. Security emails (sign-in codes, resets) are always sent.">
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
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border-soft pb-2 text-step-1 font-semibold text-text-3">
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
                        <p className="text-step-1 text-text-3 capitalize">{ev.role}</p>
                      </div>
                      <div className="flex w-16 justify-center">
                        <Checkbox checked={ch.email} onCheckedChange={() => toggle(ev.role, ev.key, "email")} ariaLabel={`Email ${ev.label}`} />
                      </div>
                      <div className="flex w-16 justify-center">
                        <Checkbox checked={ch.inApp} onCheckedChange={() => toggle(ev.role, ev.key, "inApp")} ariaLabel={`In-app ${ev.label}`} />
                      </div>
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
    </SettingsSection>
  );
}
