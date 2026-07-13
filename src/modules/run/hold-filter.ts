import { lt } from "drizzle-orm";
import * as schema from "@/db/schema";
import { releaseCutoff } from "./hold-window";

// Drizzle condition for the distribution hold. A lead is RELEASED (partner-visible) once its import
// is past the hold window, computed from the lead's own created_at at read time — so visibility
// self-releases on schedule with no dependency on the release cron. Apply in partner-scoped lead
// reads alongside the existing `isNull(leads.deletedAt)` filter; admin reads are never gated.
export function releasedLeads(now: Date = new Date()) {
  return lt(schema.leads.createdAt, releaseCutoff(now));
}
