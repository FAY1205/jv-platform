"use client";

import * as React from "react";
import { NotificationTypeIcon } from "./NotificationTypeIcon";
import { timeAgo, absoluteTime } from "@/lib/notification-time";

// The anatomy of ONE notification row (NTF-04 / NTF-12): type tile · title · body ·
// timestamp · unread mark. Extracted in WP-NF2 PR C so the bell dropdown and the
// /notifications page render the SAME row rather than two copies that drift — the two
// surfaces show the same feed, and a reader who saw a row in the bell must recognise it on
// the page. Purely presentational: the container (a DropdownMenuItem, a list button) owns
// click behaviour, padding and the unread tint.
//
// PRN-14: "unread" is carried by a dot SHAPE plus sr-only TEXT. The row tint its container
// may add is redundant reinforcement, never the only signal.

export interface NotificationRowItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationRowContentProps {
  notification: NotificationRowItem;
}

export function NotificationRowContent({ notification: n }: NotificationRowContentProps) {
  return (
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
}
