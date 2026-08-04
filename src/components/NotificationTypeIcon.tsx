import * as React from "react";
import { cn } from "@/lib/cn";
import { notificationTone, type NotificationTone } from "@/lib/notification-visual";

// A tokened tile + tone icon for a notification type (NTF-04, WS-7). Icon SHAPE + the
// adjacent title carry the meaning; the tint is redundant (PRN-14). Purely presentational
// so NotificationBell, the gallery, and screenshot routes all render identical tiles.

// Reuse the app's established tone-tint idiom (Badge/Stat): a solid `-soft` fill + the
// strong tone text — all AA-gated by tokens.test.ts — rather than ad-hoc opacity tints.
const TILE: Record<NotificationTone, string> = {
  route: "bg-brand-soft text-brand-ink",
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-3 text-text-2",
  hot: "bg-warn-soft text-warn",
};

function ToneIcon({ tone }: { tone: NotificationTone }) {
  const p = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (tone === "success") return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
  if (tone === "route") return <svg {...p}><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" /></svg>;
  if (tone === "info") return <svg {...p}><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>;
  // hot: the same concentric-circle target used for the hot-lead row mark.
  if (tone === "hot") return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></svg>;
  return (
    <svg {...p}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export interface NotificationTypeIconProps {
  type: string;
  className?: string;
}

export function NotificationTypeIcon({ type, className }: NotificationTypeIconProps) {
  const tone = notificationTone(type);
  return (
    <span aria-hidden="true" className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", TILE[tone], className)}>
      <ToneIcon tone={tone} />
    </span>
  );
}
