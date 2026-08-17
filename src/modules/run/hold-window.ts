// C-33: moved to src/lib/hold.ts (so lib/scope.ts depends only on lib primitives). This shim
// re-exports the original surface so existing `@/modules/run/hold-window` importers are unchanged.
export { HOLD_WINDOW_MS, isHeld, releaseCutoff } from "@/lib/hold";
