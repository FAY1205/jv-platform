"use client";

import * as React from "react";
import Link from "next/link";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { cn } from "@/lib/cn";
import { groupByDay } from "@/lib/notification-groups";
import { NOTIFICATIONS_FEED_KEY, NOTIFICATIONS_PAGE_KEY } from "@/lib/notification-keys";
import { Button } from "./Button";
import { Card, CardBody, CardHeader, CardTitle } from "./Card";
import { Checkbox } from "./Checkbox";
import { Switch } from "./Switch";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { QueryErrorState } from "./QueryErrorState";
import { useToast } from "./Toast";
import { NotificationRowContent, type NotificationRowItem } from "./NotificationRowContent";

// ─────────────────────────────────────────────────────────────────────────────
// NTF-12 + NTF-15 — the full /notifications surface, shared VERBATIM by both roles.
//
// Mounted by `(admin)/notifications/page.tsx` (AppShell) and `portal/notifications/page.tsx`
// (PortalShell). Nothing here is role-aware: deep links are already role-appropriate on the
// stored row, and the preferences catalog comes back scoped to the caller's own bucket. One
// component, so the partner portal cannot quietly drift from the admin surface.
//
// Two paged sections:
//   1. The FEED — day-grouped, keyset-paginated via `useInfiniteQuery` on `nextCursor`.
//   2. PREFERENCES (NTF-15) — the per-seat overlay editor. This is the ONLY self-serve
//      notification surface a partner, member or viewer seat has; the tenant-defaults matrix
//      under /settings is `settings.manage`-gated.
//
// Virtualization: deliberately NONE. The endpoint caps a page at 50 rows (FEED_PAGE_MAX) and
// this page asks for 30, so the DOM grows only when the reader explicitly presses "Load more".
// FRONTEND_STANDARDS' "virtualize lists that can exceed ~200 rows" is about lists that arrive
// unbounded — server-side paging is the other half of that rule, and it is what is used here.
// ─────────────────────────────────────────────────────────────────────────────

/** Rows per "Load more" press. Server-clamped to FEED_PAGE_MAX regardless. */
const PAGE_SIZE = 30;

const PREFS_KEY = ["my-notification-prefs"] as const;

interface FeedPage {
  notifications: NotificationRowItem[];
  unread: number;
  nextCursor: string | null;
}

type FeedData = InfiniteData<FeedPage, string | null>;

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

/** POST a read-marking endpoint; a non-2xx THROWS so the optimistic update rolls back
 *  (a bare `fetch` resolves on 500 and would leave the row falsely marked read). Same
 *  helper shape as the bell — the two surfaces share the endpoints AND the failure mode. */
async function postRead(path: string): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: "{}",
  });
  if (!res.ok) throw new Error("Could not mark the notification read.");
}

function feedUrl(cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  return `/api/notifications?${params.toString()}`;
}

/** Map one notification across EVERY loaded page. The unread count rides on each page (the
 *  server sends the whole-feed number on all of them), so it moves on all of them too —
 *  otherwise page 1's badge and page 2's would disagree after a mark-read. */
function patchPages(data: FeedData, patch: (p: FeedPage) => FeedPage): FeedData {
  return { ...data, pages: data.pages.map(patch) };
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const [showPrefs, setShowPrefs] = React.useState(false);

  const feed = useInfiniteQuery({
    queryKey: NOTIFICATIONS_PAGE_KEY,
    queryFn: ({ pageParam }) => apiGet<FeedPage>(feedUrl(pageParam)),
    initialPageParam: null as string | null,
    // `null` ends the list — the server returns it as soon as a page comes back short.
    getNextPageParam: (last) => last.nextCursor,
    // Focus-refetch ONLY while a single page is loaded. TanStack refetches EVERY loaded page of
    // an infinite query, and each page also recomputes the unread count server-side — so a
    // blanket `true` costs 2N queries per tab focus after N presses of "Load more", which is
    // real load for a reader who has simply scrolled back through their history. Gating on
    // "at most one page loaded" keeps the case that actually matters (open the page, tab away,
    // come back to a fresh top-of-feed) at its old cost and drops the amplification. Deeper
    // pages are history: they do not change, and anything that DOES change them — a mark-read or
    // mark-all from either surface — invalidates both keys explicitly, so the page still
    // reconciles. Retry/refetch remains available from the error state.
    refetchOnWindowFocus: (query) => (query.state.data?.pages.length ?? 0) <= 1,
  });

  const notifications = React.useMemo(
    () => (feed.data?.pages ?? []).flatMap((p) => p.notifications),
    [feed.data],
  );
  const unread = feed.data?.pages[0]?.unread ?? 0;

  // NTF-12: both caches, so the bell in the chrome above this page agrees with it.
  const invalidateFeeds = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: NOTIFICATIONS_FEED_KEY }),
      qc.invalidateQueries({ queryKey: NOTIFICATIONS_PAGE_KEY }),
    ]);

  // OPTIMISTIC read-marking, the bell's mutation shape (cancel → snapshot → setQueryData →
  // roll back on error → invalidate on settle), adapted to the infinite cache.
  const markRead = useMutation({
    mutationFn: (id: string) => postRead(`/api/notifications/${id}/read`),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_PAGE_KEY });
      const prev = qc.getQueryData<FeedData>(NOTIFICATIONS_PAGE_KEY);
      const target = prev?.pages.flatMap((p) => p.notifications).find((n) => n.id === id);
      // Already read → the count must not drift down below the truth.
      if (prev && target && !target.readAt) {
        const at = new Date().toISOString();
        qc.setQueryData<FeedData>(NOTIFICATIONS_PAGE_KEY, (old) =>
          old
            ? patchPages(old, (p) => ({
                ...p,
                unread: Math.max(0, p.unread - 1),
                notifications: p.notifications.map((n) => (n.id === id ? { ...n, readAt: at } : n)),
              }))
            : old,
        );
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(NOTIFICATIONS_PAGE_KEY, ctx.prev);
    },
    onSettled: invalidateFeeds,
  });

  const markAll = useMutation({
    mutationFn: () => postRead("/api/notifications/read-all"),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_PAGE_KEY });
      const prev = qc.getQueryData<FeedData>(NOTIFICATIONS_PAGE_KEY);
      const at = new Date().toISOString();
      qc.setQueryData<FeedData>(NOTIFICATIONS_PAGE_KEY, (old) =>
        old
          ? patchPages(old, (p) => ({
              ...p,
              unread: 0,
              notifications: p.notifications.map((n) => (n.readAt ? n : { ...n, readAt: at })),
            }))
          : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(NOTIFICATIONS_PAGE_KEY, ctx.prev);
    },
    onSettled: invalidateFeeds,
  });

  const groups = groupByDay(notifications, new Date());

  // One row recipe for both link and in-place rows, so the two never diverge visually and
  // every interactive state (hover / focus-visible / active) is declared once.
  const rowClass = (readAt: string | null) =>
    cn(
      "block w-full rounded-lg px-3 py-2.5 text-left outline-none transition-colors",
      "hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-brand-ink active:bg-surface-3",
      !readAt && "bg-brand-soft/40",
    );

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header: the unread line + the two page-level actions ───────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-3" aria-live="polite">
          {feed.isPending
            ? "Loading your notifications…"
            : unread > 0
              ? `${unread.toLocaleString()} unread`
              : "No unread notifications"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => markAll.mutate()}
            loading={markAll.isPending}
            // Nothing to mark when the feed is empty, still loading, or already clear.
            disabled={unread === 0}
          >
            Mark all read
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPrefs((v) => !v)}
            aria-expanded={showPrefs}
            // Only reference the panel while it exists — a dangling aria-controls id is
            // worse than none.
            aria-controls={showPrefs ? "notification-preferences" : undefined}
          >
            Preferences
          </Button>
        </div>
      </div>

      {/* ── NTF-15 preferences (lazy: the query only runs once the card is opened) ── */}
      {showPrefs && <PreferencesCard />}

      {/* ── NTF-12 feed ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardBody className="p-2 sm:p-3">
          {feed.error ? (
            <div className="p-4">
              <QueryErrorState
                title="Couldn't load notifications"
                error={feed.error}
                onRetry={() => feed.refetch()}
              />
            </div>
          ) : feed.isPending ? (
            <div className="flex flex-col gap-2 p-2" aria-hidden="true">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState
              title="You're all caught up."
              description="New activity on your leads, tasks and imports will show up here."
            />
          ) : (
            <>
              {groups.map((group) => (
                <div key={group.key}>
                  <p className="px-3 pb-1 pt-3 text-step-1 font-semibold uppercase tracking-wide text-text-3">
                    {group.label}
                  </p>
                  {group.items.map((n) =>
                    n.deepLink ? (
                      // Deep-linked: navigate AND mark read. The mark is optimistic and the
                      // navigation does not wait on it.
                      <Link
                        key={n.id}
                        href={n.deepLink}
                        className={rowClass(n.readAt)}
                        onClick={() => {
                          if (!n.readAt) markRead.mutate(n.id);
                        }}
                      >
                        <NotificationRowContent notification={n} />
                      </Link>
                    ) : !n.readAt ? (
                      // No deep link: the row's only action is marking itself read in place.
                      <button
                        key={n.id}
                        type="button"
                        className={cn(rowClass(n.readAt), "disabled:pointer-events-none disabled:opacity-60")}
                        onClick={() => markRead.mutate(n.id)}
                      >
                        <NotificationRowContent notification={n} />
                      </button>
                    ) : (
                      // Read, and nowhere to go: a focusable control that does nothing is a
                      // keyboard trap for no benefit, so this row is plain content.
                      <div key={n.id} className="px-3 py-2.5">
                        <NotificationRowContent notification={n} />
                      </div>
                    ),
                  )}
                </div>
              ))}

              {feed.hasNextPage && (
                <div className="flex justify-center px-3 pb-2 pt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => feed.fetchNextPage()}
                    loading={feed.isFetchingNextPage}
                    disabled={feed.isFetchingNextPage}
                  >
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NTF-15 — the caller's own delivery preferences.
//
// CATALOG-DRIVEN: every row comes from whatever `/api/me/notification-prefs` returns for the
// caller's bucket. New event types (WP-NF2 PR B) appear here with no change to this file, and
// a partner sees partner rows only.
//
// The values shown are EFFECTIVE (tenant default ⊕ this seat's overlay), and Save PUTs exactly
// what is on screen as this seat's overlay. WYSIWYG on purpose: the alternative — sending only
// the legs the seat has "changed" — needs a notion of change the endpoint does not expose, and
// would let a checkbox the reader sees ticked mean something other than what gets saved.
// ─────────────────────────────────────────────────────────────────────────────
function PreferencesCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: PREFS_KEY,
    queryFn: () => apiGet<PrefsView>("/api/me/notification-prefs"),
  });

  // Seed the editable draft from server truth the first time (and whenever it changes) by
  // adjusting state during render — the React-recommended alternative to an effect, and the
  // same idiom the tenant-defaults matrix uses.
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
      qc.invalidateQueries({ queryKey: PREFS_KEY });
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
    <Card id="notification-preferences">
      <CardHeader>
        <CardTitle as="h2">Your notification preferences</CardTitle>
      </CardHeader>
      <CardBody className="pt-0">
        <p className="mb-4 text-step-1 text-text-3">
          These choices apply to your account only and override the workspace defaults. Email is off by
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
