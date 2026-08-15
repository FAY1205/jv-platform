// Per-row pending tracking for list mutations (pr F-2, WP-TSK-4/5).
//
// A shared `useMutation`'s `.isPending` / `.variables` reflect only the LAST call, so
// mutating row B while row A's request is still in flight makes row A's `variables` stale
// and re-enables its control early. Components keep a local `Set<id>` instead, updated in
// onMutate/onSettled, so every row's pending state is independently correct.
//
// Both helpers return the SAME set reference when the operation is a no-op, so a
// `setState(s => withAdded(s, id))` on an id already present does not re-render.

/** The set plus `id` — the same reference back when it is already a member. Pure. */
export function withAdded<T>(set: ReadonlySet<T>, id: T): ReadonlySet<T> {
  if (set.has(id)) return set;
  const next = new Set(set);
  next.add(id);
  return next;
}

/** The set minus `id` — the same reference back when it is not a member. Pure. */
export function withRemoved<T>(set: ReadonlySet<T>, id: T): ReadonlySet<T> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}
