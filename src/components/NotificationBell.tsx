"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { cn } from "@/lib/cn";

// NTF-04: in-app notification center. Bell + unread badge; a dropdown lists
// notifications with deep links and mark-read. Server data via TanStack Query only.

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
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<{ notifications: Notification[]; unread: number }>("/api/notifications"),
    refetchInterval: 20_000,
  });
  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        className="relative grid h-8 w-8 place-items-center rounded-md text-text-2 transition-colors hover:bg-surface-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-brand px-1 text-[.6rem] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border-soft px-3 py-2">
            <span className="text-sm font-semibold text-text">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => markAll.mutate()} className="text-xs text-brand hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-auto">
            {notifications.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-text-3">You&apos;re all caught up.</li>
            ) : (
              notifications.map((n) => {
                const inner = (
                  <>
                    <div className="flex items-start gap-2">
                      {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />}
                      <div className={cn("min-w-0", n.readAt && "pl-3.5")}>
                        <p className="truncate text-sm font-medium text-text">{n.title}</p>
                        {n.body && <p className="text-xs text-text-3">{n.body}</p>}
                        <p className="mt-0.5 text-[.66rem] text-text-3">{timeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  </>
                );
                const onActivate = () => {
                  if (!n.readAt) markRead.mutate(n.id);
                  setOpen(false);
                };
                return (
                  <li key={n.id} className={cn("border-b border-border-soft last:border-0", !n.readAt && "bg-brand-soft/40")}>
                    {n.deepLink ? (
                      <Link href={n.deepLink} onClick={onActivate} className="block px-3 py-2.5 hover:bg-surface-2">
                        {inner}
                      </Link>
                    ) : (
                      <button type="button" onClick={onActivate} className="block w-full px-3 py-2.5 text-left hover:bg-surface-2">
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
