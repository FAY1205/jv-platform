import { lt } from "drizzle-orm";
import * as schema from "@/db/schema";
import { releaseCutoff } from "@/lib/hold";

// C-33: the drizzle read predicate for the distribution hold, hoisted to lib/ (imports drizzle +
// schema, so kept OUT of lib/hold.ts to preserve that file's client-safety). A lead is RELEASED
// (partner-visible) once its import is past the hold window, computed from the lead's own created_at
// at read time — so visibility self-releases on schedule with no dependency on the release cron.
// Apply in partner-scoped lead reads alongside `isNull(leads.deletedAt)`; admin reads are never gated.
// Re-exported from src/modules/run/hold-filter.ts for the existing call sites.
export function releasedLeads(now: Date = new Date()) {
  return lt(schema.leads.createdAt, releaseCutoff(now));
}
