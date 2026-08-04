"use client";

import * as React from "react";

// useDebouncedValue (FU-3) — the shared 300ms search/filter debounce that was hand-rolled
// as an identical setTimeout effect in several list pages. Returns the latest `value` only
// after it has been stable for `ms`; rapid changes reset the timer so only the last commits.
// NOTE: leads-view keeps its own committed-state debounce on purpose — it needs a SYNCHRONOUS
// reset on "Clear all" (and a ?q= re-seed) that a derived value can't provide.
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
