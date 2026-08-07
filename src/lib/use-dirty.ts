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
  const snapshot = JSON.stringify(value);
  // Capture the baseline snapshot once, on the first render where `ready` is true (a create form:
  // the first render; an edit form that seeds asynchronously: after the record loads). Held in
  // state and captured via adjust-state-during-render — the same idiom as the `seeded`/`prevOpen`
  // patterns elsewhere — which converges in one extra render and reads no ref during render.
  const [baseline, setBaseline] = React.useState<string | null>(() => (ready ? snapshot : null));
  if (ready && baseline === null) setBaseline(snapshot);
  return baseline !== null && snapshot !== baseline;
}
