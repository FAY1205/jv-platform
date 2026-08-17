// C-33: moved to src/lib/hold.ts (so lib/scope.ts depends only on lib primitives). This shim
// re-exports the original surface so existing `@/modules/run/void-window` importers are unchanged.
export { VOID_WINDOW_MS, isWithinVoidWindow } from "@/lib/hold";
