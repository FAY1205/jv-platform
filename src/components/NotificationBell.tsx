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
import { NotificationTypeIcon } from "./NotificationTypeIcon";
import { groupByDay } from "@/lib/notification-groups";

// NTF-04: in-app notification center on the DropdownMenu primitive (WS-7f). Grouped by
// day, mark-all-read + per-item read, deep links; an honest error state (F-21), an
// aria-live unread announcement (F-7), and visibility-aware polling (F-87 — pauses on a
// hidden tab, refetches on focus). Server data via TanStack Query only.

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Feed {
  notifications: Notification[];
  unread: number;
}

const FEED_KEY = ["notifications"] as const;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The full local-time reading of a timestamp, for the <time> element's tooltip: "2h ago" is
 *  friendly but lossy, and "was that 2pm or 2am?" is a real question when a nudge matters. */
function absoluteTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

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

export function NotificationBell() {
  const qc = useQueryClient();

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
    onSettled: () => qc.invalidateQueries({ queryKey: FEED_KEY }),
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
    onSettled: () => qc.invalidateQueries({ queryKey: FEED_KEY }),
  });

  const groups = groupByDay(notifications, new Date());

  const row = (n: Notification) => (
    <div className="flex items-start gap-2.5">
      <NotificationTypeIcon type={n.type} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">
          {!n.readAt && <span className="sr-only">Unread: </span>}
          {n.title}
        </p>
        {n.body && <p className="text-step-1 text-text-3">{n.body}</p>}
        {/* The relative string is the readable one, but it's lossy and it silently goes stale
            in a long-lived tab — <time dateTime> keeps the machine-readable instant on the
            element and the full local time in the tooltip. */}
        <p className="num mt-0.5 text-step-1 text-text-3">
          <time dateTime={n.createdAt} title={absoluteTime(n.createdAt)}>
            {timeAgo(n.createdAt)}
          </time>
        </p>
      </div>
      {/* Unread = a dot SHAPE on the right (never tint alone) — PRN-14. */}
      {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />}
    </div>
  );

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
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
