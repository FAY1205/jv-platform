// C-33: moved to src/lib/hold-filter.ts (so lib/scope.ts depends only on lib primitives). This shim
// re-exports the original surface so existing `@/modules/run/hold-filter` importers are unchanged.
export { releasedLeads } from "@/lib/hold-filter";
