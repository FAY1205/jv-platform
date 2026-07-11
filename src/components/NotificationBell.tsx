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
import { EmptyState } from "./EmptyState";
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

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell() {
  const qc = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<{ notifications: Notification[]; unread: number }>("/api/notifications"),
    // F-87: don't poll a backgrounded tab; refetch when the user returns to it.
    refetchInterval: () => (typeof document !== "undefined" && document.hidden ? false : 30_000),
    refetchOnWindowFocus: true,
  });
  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/notifications/${id}/read`, { method: "POST", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAll = useMutation({
    mutationFn: () =>
      fetch(`/api/notifications/read-all`, { method: "POST", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
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
        {n.body && <p className="text-[13px] text-text-3">{n.body}</p>}
        <p className="num mt-0.5 text-[13px] text-text-3">{timeAgo(n.createdAt)}</p>
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
          <button
            type="button"
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            className="relative grid h-8 w-8 place-items-center rounded-md text-text-2 transition-colors hover:bg-surface-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-brand px-1 text-[.6rem] font-bold text-brand-contrast">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between border-b border-border-soft px-3 py-2">
            <span className="text-sm font-semibold text-text">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => markAll.mutate()} className="text-xs text-brand-ink hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-auto py-1">
            {error ? (
              <div className="px-2 py-4">
                <EmptyState title="Couldn't load notifications" description="Check your connection and try again." />
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
                  <DropdownMenuLabel className="text-[.62rem] uppercase tracking-wide text-text-3">{group.label}</DropdownMenuLabel>
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
