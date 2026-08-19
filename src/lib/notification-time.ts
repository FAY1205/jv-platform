// Notification timestamp rendering (NTF-04 / NTF-12). PURE over a passed-in `now` (the
// `groupByDay` convention in notification-groups.ts) so both the bell and the /notifications
// page format identically and the formatting is unit-testable without freezing the clock.

/** The friendly, lossy reading: "just now" · "12m ago" · "3h ago" · "5d ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The full local-time reading, for the `<time>` element's tooltip: "2h ago" is readable but
 *  lossy, and "was that 2pm or 2am?" is a real question when a nudge matters. An unparseable
 *  value falls through to itself rather than rendering "Invalid Date". */
export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
