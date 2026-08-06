import * as React from "react";

/**
 * useDirty — has `value` changed since its baseline was captured? (FRM-02a support.)
 *
 * Serializes `value` and compares it to the first snapshot taken once `ready` is true.
 * For a create form pass `ready` = true from the start (baseline = the empty form). For an
 * edit form that seeds its fields asynchronously, pass `ready` = <seeded> so the baseline is
 * the loaded record rather than the pre-seed blank. Feed the result to `<Dialog confirmClose>`
 * so a dismiss gesture (Esc/backdrop/✕) on a dirty form asks before discarding.
 */
export function useDirty(value: unknown, ready: boolean = true): boolean {
  const baseline = React.useRef<string | null>(null);
  const snapshot = JSON.stringify(value);
  // Capture once, the first ready render — an idempotent ref write, not reactive state.
  if (ready && baseline.current === null) {
    baseline.current = snapshot;
  }
  return baseline.current !== null && snapshot !== baseline.current;
}
