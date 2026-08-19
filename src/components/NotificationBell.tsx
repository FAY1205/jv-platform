"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "./DropdownMenu";
import { QueryErrorState } from "./QueryErrorState";
import { IconButton } from "./IconButton";
import { Skeleton } from "./Skeleton";
import { NotificationRowContent, type NotificationRowItem } from "./NotificationRowContent";
import { groupByDay } from "@/lib/notification-groups";
import { NOTIFICATIONS_FEED_KEY, NOTIFICATIONS_PAGE_KEY } from "@/lib/notification-keys";

// NTF-04: in-app notification center on the DropdownMenu primitive (WS-7f). Grouped by
// day, mark-all-read + per-item read, deep links; an honest error state (F-21), an
// aria-live unread announcement (F-7), and visibility-aware polling (F-87 — pauses on a
// hidden tab, refetches on focus). Server data via TanStack Query only.
//
// WP-NF2 (NTF-12): the dropdown is the SUMMARY surface — 30 newest rows, no paging. The
// `viewAllHref` footer hands off to the full /notifications page, which pages the same
// endpoint. The row anatomy is shared with that page via NotificationRowContent.

type Notification = NotificationRowItem;

interface Feed {
  notifications: Notification[];
  unread: number;
  /** FEP-03, additive: the bell never pages, so it simply ignores this. */
  nextCursor?: string | null;
}

const FEED_KEY = NOTIFICATIONS_FEED_KEY;

/** POST a read-marking endpoint; a non-2xx THROWS so the optimistic update rolls back
 *  (a bare `fetch` resolves on 500 and would leave the row falsely marked read). */
async function postRead(path: string): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: "{}",
  });
  if (!res.ok) throw new Error("Could not mark the notification read.");
}

export interface NotificationBellProps {
  /** NTF-12: when set, a persistent "View all notifications" footer row links here —
   *  `/notifications` from AppShell, `/portal/notifications` from PortalShell. Omitted, the
   *  dropdown is exactly the pre-NF2 panel. */
  viewAllHref?: string;
}

export function NotificationBell({ viewAllHref }: NotificationBellProps = {}) {
  const qc = useQueryClient();
  // NTF-12: both notification caches, so the bell badge and an open /notifications page in the
  // same tab settle on the same server truth. Named explicitly rather than leaning on the
  // prefix match (see notification-keys.ts).
  const invalidateFeeds = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: NOTIFICATIONS_FEED_KEY }),
      qc.invalidateQueries({ queryKey: NOTIFICATIONS_PAGE_KEY }),
    ]);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: FEED_KEY,
    queryFn: () => apiGet<Feed>("/api/notifications"),
    // F-87: don't poll a backgrounded tab; refetch when the user returns to it.
    refetchInterval: () => (typeof document !== "undefined" && document.hidden ? false : 30_000),
    refetchOnWindowFocus: true,
  });
  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  // WP-NF1 D8: OPTIMISTIC read-marking (the TasksPanel toggle shape — cancel, snapshot,
  // setQueryData, roll back on error, invalidate on settle). Invalidate-only meant the dot,
  // the row tint and the badge count all lagged a network round-trip behind the click, which
  // on a slow link reads as "the click didn't register" and invites a second one.
  const markRead = useMutation({
    mutationFn: (id: string) => postRead(`/api/notifications/${id}/read`),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: FEED_KEY });
      const prev = qc.getQueryData<Feed>(FEED_KEY);
      qc.setQueryData<Feed>(FEED_KEY, (old) => {
        if (!old) return old;
        const target = old.notifications.find((n) => n.id === id);
        if (!target || target.readAt) return old; // already read → the count must not drift down
        return {
          notifications: old.notifications.map((n) =>
            n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
          ),
          unread: Math.max(0, old.unread - 1),
        };
      });
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(FEED_KEY, ctx.prev);
    },
    onSettled: invalidateFeeds,
  });
  const markAll = useMutation({
    mutationFn: () => postRead(`/api/notifications/read-all`),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: FEED_KEY });
      const prev = qc.getQueryData<Feed>(FEED_KEY);
      const at = new Date().toISOString();
      qc.setQueryData<Feed>(FEED_KEY, (old) =>
        old ? { notifications: old.notifications.map((n) => (n.readAt ? n : { ...n, readAt: at })), unread: 0 } : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(FEED_KEY, ctx.prev);
    },
    onSettled: invalidateFeeds,
  });

  const groups = groupByDay(notifications, new Date());

  const row = (n: Notification) => <NotificationRowContent notification={n} />;

  return (
    <>
      {/* F-7: announce unread changes to assistive tech without a visual change. */}
      <span aria-live="polite" className="sr-only">
        {unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : ""}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            {/* Badge anchors to this icon-sized wrapper, not the 44px button, so the 44px
                tap target doesn't detach the count from the bell. */}
            <span className="relative grid h-[18px] w-[18px] place-items-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              {/* DSN-11 glyph-fit carve-out (WP-P): the count is sized to fit the 16px
                  badge circle, not to a reading step — excluded from the text-step ladder
                  by design (FRONTEND_STANDARDS §2). Not a tap target. */}
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-brand px-1 text-[.6rem] font-bold text-brand-contrast">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </span>
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between border-b border-border-soft px-3 py-2">
            <span className="text-sm font-semibold text-text">Notifications</span>
            {unread > 0 && (
              // C-52 (WCAG 2.5.8): a 16px-tall text link → 28px of invisible reach via a
              // pseudo-element. The panel header's px-3/py-2 padding absorbs it and the only
              // neighbor is the non-interactive "Notifications" label, so nothing shifts and
              // no adjacent target loses clicks.
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="relative rounded text-xs text-brand-ink outline-none before:absolute before:-inset-1.5 before:content-[''] hover:underline focus-visible:ring-1 focus-visible:ring-brand-ink"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-auto py-1">
            {error ? (
              <div className="px-2 py-4">
                <QueryErrorState title="Couldn't load notifications" error={error} onRetry={() => refetch()} />
              </div>
            ) : isPending ? (
              <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-text-3">You&apos;re all caught up.</p>
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  {/* WP-P: DropdownMenuLabel's own text-xs (12px) is the target size — the
                      former sub-12px .62rem override is dropped, no font-size class needed. */}
                  <DropdownMenuLabel className="uppercase tracking-wide text-text-3">{group.label}</DropdownMenuLabel>
                  {group.items.map((n) =>
                    n.deepLink ? (
                      <DropdownMenuItem
                        key={n.id}
                        asChild
                        className={cn("px-3 py-2.5", !n.readAt && "bg-brand-soft/40")}
                        onSelect={() => {
                          if (!n.readAt) markRead.mutate(n.id);
                        }}
                      >
                        <Link href={n.deepLink}>{row(n)}</Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        key={n.id}
                        className={cn("px-3 py-2.5", !n.readAt && "bg-brand-soft/40")}
                        onSelect={(e) => {
                          e.preventDefault(); // stay open when just marking read (no navigation)
                          if (!n.readAt) markRead.mutate(n.id);
                        }}
                      >
                        {row(n)}
                      </DropdownMenuItem>
                    ),
                  )}
                </div>
              ))
            )}
          </div>
          {/* NTF-12: the handoff to the full page. OUTSIDE the scrolling list and rendered in
              EVERY state — loading, error, empty, full — because "where do I see the rest?"
              is exactly the question an empty or failed panel raises, and a footer that comes
              and goes with the data is a footer nobody learns to look for. */}
          {viewAllHref && (
            <div className="border-t border-border-soft p-1">
              <DropdownMenuItem asChild className="justify-center px-3 py-2 text-sm font-medium text-brand-ink">
                <Link href={viewAllHref}>View all notifications</Link>
              </DropdownMenuItem>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
