"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { Button } from "./Button";
import { Card, CardBody, CardHeader, CardTitle } from "./Card";
import { Checkbox } from "./Checkbox";
import { Switch } from "./Switch";
import { Skeleton } from "./Skeleton";
import { QueryErrorState } from "./QueryErrorState";
import { useToast } from "./Toast";

// ─────────────────────────────────────────────────────────────────────────────
// NTF-15 — the caller's own delivery preferences. ONE implementation, two mounts:
//
//   • the PORTAL /notifications page renders it inline (a partner cannot enter admin
//     Settings, so this is their only surface);
//   • the ADMIN-stream Settings → Notifications page IS this card (WP-NF2b) — the
//     workspace matrix that used to live there is retired, and /notifications links here.
//
// Extracted from NotificationsPage in WP-NF2b rather than copied: two notification-preference
// editors would be two places for the kill switch's email-only rule to drift.
//
// CATALOG-DRIVEN: every row comes from whatever `/api/me/notification-prefs` returns for the
// caller's bucket. A new event type appears here with no change to this file, and a partner
// sees partner rows only.
//
// The values shown are EFFECTIVE (shipped default ⊕ this seat's overlay), and Save PUTs exactly
// what is on screen as this seat's overlay. WYSIWYG on purpose: the alternative — sending only
// the legs the seat has "changed" — needs a notion of change the endpoint does not expose, and
// would let a checkbox the reader sees ticked mean something other than what gets saved.
//
// WP-NF2b: there is NO workspace layer above this any more (owner decision 2026-08-20). Every
// user controls their own notifications, scoped to their role's catalog.
// ─────────────────────────────────────────────────────────────────────────────

/** The shared query key, so a save on either mount invalidates the other's cache. */
export const MY_NOTIFICATION_PREFS_KEY = ["my-notification-prefs"] as const;

interface Channel {
  email: boolean;
  inApp: boolean;
}
interface PrefEvent {
  key: string;
  label: string;
  effective: Channel;
  overridden: { email: boolean; inApp: boolean };
}
interface PrefsView {
  role: "admin" | "partner";
  allEmailsOff: boolean;
  events: PrefEvent[];
}

export interface NotificationPreferencesCardProps {
  /** DOM id, so a disclosure button elsewhere can `aria-controls` this card. */
  id?: string;
}

export function NotificationPreferencesCard({ id }: NotificationPreferencesCardProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: MY_NOTIFICATION_PREFS_KEY,
    queryFn: () => apiGet<PrefsView>("/api/me/notification-prefs"),
  });

  // Seed the editable draft from server truth the first time (and whenever it changes) by
  // adjusting state during render — the React-recommended alternative to an effect.
  const [draft, setDraft] = React.useState<{ allEmailsOff: boolean; channels: Record<string, Channel> } | null>(null);
  const [seededFrom, setSeededFrom] = React.useState<PrefsView | null>(null);
  if (data && data !== seededFrom) {
    setSeededFrom(data);
    setDraft({
      allEmailsOff: data.allEmailsOff,
      channels: Object.fromEntries(data.events.map((e) => [e.key, { ...e.effective }])),
    });
  }

  const save = useMutation({
    mutationFn: (body: { allEmailsOff: boolean; events: Record<string, Channel> }) =>
      apiMutate<PrefsView>("/api/me/notification-prefs", "PUT", body),
    onSuccess: () => {
      // ADR-0008 / F-79: refetch server truth so the draft re-seeds from it rather than from
      // the payload we just sent.
      qc.invalidateQueries({ queryKey: MY_NOTIFICATION_PREFS_KEY });
      toast("Notification preferences saved.", "success");
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  const toggle = (key: string, channel: keyof Channel) =>
    setDraft((d) =>
      d ? { ...d, channels: { ...d.channels, [key]: { ...d.channels[key], [channel]: !d.channels[key][channel] } } } : d,
    );

  const events = data?.events ?? [];

  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle as="h2">Your notification preferences</CardTitle>
      </CardHeader>
      <CardBody className="pt-0">
        <p className="mb-4 text-step-1 text-text-3">
          These choices apply to your account only — everyone here sets their own. Email is off by
          default for newer notification types. Security email — sign-in codes, password resets — is always
          sent and is not affected by anything here.
        </p>
        {error ? (
          <QueryErrorState title="Couldn't load your preferences" error={error} onRetry={() => refetch()} />
        ) : isPending || !draft ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border-soft pb-2 text-step-1 font-semibold text-text-3">
              <span>Notification</span>
              <span className="w-16 text-center">Email</span>
              <span className="w-16 text-center">In-app</span>
            </div>
            {events.map((ev) => {
              const ch = draft.channels[ev.key] ?? { email: false, inApp: false };
              return (
                <div key={ev.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5">
                  <p className="text-sm text-text">{ev.label}</p>
                  <div className="flex w-16 justify-center">
                    <Checkbox
                      checked={ch.email}
                      onCheckedChange={() => toggle(ev.key, "email")}
                      // STANDING inert state, not a transient one: while emails are paused this
                      // choice cannot take effect, and that stays true until the reader flips the
                      // switch below. `ariaDisabled` (not native `disabled`) per the Checkbox
                      // contract — the box keeps its place in the tab order and its accessible
                      // name, so a keyboard user can reach it and find out WHY it is inert
                      // instead of tabbing over a control that silently vanished.
                      ariaDisabled={draft.allEmailsOff}
                      ariaLabel={`Email ${ev.label}`}
                    />
                  </div>
                  <div className="flex w-16 justify-center">
                    <Checkbox
                      checked={ch.inApp}
                      onCheckedChange={() => toggle(ev.key, "inApp")}
                      ariaLabel={`In-app ${ev.label}`}
                    />
                  </div>
                </div>
              );
            })}

            <div className="mt-3 flex items-start gap-3 rounded-xl border border-border-soft bg-surface-2 p-3">
              <Switch
                checked={draft.allEmailsOff}
                onCheckedChange={(v) =>
                  setDraft((d) =>
                    // NTF-13 §10.7: the kill switch is EMAIL-only. Turning it on clears the
                    // email column (that is what will be saved — nothing hidden); in-app is
                    // untouched, so unsubscribing can never blind someone's bell.
                    d
                      ? {
                          allEmailsOff: v,
                          channels: v
                            ? Object.fromEntries(Object.entries(d.channels).map(([k, c]) => [k, { ...c, email: false }]))
                            : d.channels,
                        }
                      : d,
                  )
                }
                ariaLabel="Pause all notification emails"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">Pause all notification emails</p>
                <p className="text-step-1 text-text-3">
                  Stops every notification email to your address. Your in-app notifications keep arriving,
                  and security email is unaffected.
                </p>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                loading={save.isPending}
                onClick={() =>
                  save.mutate({
                    allEmailsOff: draft.allEmailsOff,
                    events: Object.fromEntries(events.map((ev) => [ev.key, draft.channels[ev.key]])),
                  })
                }
              >
                Save preferences
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
