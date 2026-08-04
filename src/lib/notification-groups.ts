// WS-7f: group notifications by calendar day for the notification center. Pure over a
// passed-in `now` (no Date.now() inside) so it's deterministic and unit-testable. Items
// are expected pre-sorted newest-first; a group's insertion order follows first sight.

export interface DayGroup<T> {
  key: string;
  label: string;
  items: T[];
}

function labelFor(day: Date, now: Date): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day.toDateString() === now.toDateString()) return "Today";
  if (day.toDateString() === yesterday.toDateString()) return "Yesterday";
  const sameYear = day.getFullYear() === now.getFullYear();
  return day.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function groupByDay<T extends { createdAt: string }>(items: T[], now: Date): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const byKey = new Map<string, DayGroup<T>>();
  for (const item of items) {
    const day = new Date(item.createdAt);
    const key = day.toDateString();
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: labelFor(day, now), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
