import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";

// CVG-02 read side for the Rules area (MLS phrases). Admin-only; all reads scoped
// (PRN-08). Coverage moved to Partners (WS-5); recodes removed (ADR-0018).
//
// Read-only surface (2026-08-01): the phrase set is fixed in code (seed + migrations)
// and has no runtime edit path. Only ENABLED phrases are returned — a tenant that
// predates a migration retiring a v1 pattern must not see (and could once re-enable)
// the disabled row. What runs is what's shown.

export interface MlsPatternRow {
  id: string;
  patternKey: string;
  type: "disqualify" | "keep_override";
  regex: string;
  flags: string;
  label: string;
  enabled: boolean;
}

export async function listMlsPatterns(scope: ScopeContext): Promise<MlsPatternRow[]> {
  return getDb()
    .select({
      id: schema.mlsPatterns.id,
      patternKey: schema.mlsPatterns.patternKey,
      type: schema.mlsPatterns.type,
      regex: schema.mlsPatterns.regex,
      flags: schema.mlsPatterns.flags,
      label: schema.mlsPatterns.label,
      enabled: schema.mlsPatterns.enabled,
    })
    .from(schema.mlsPatterns)
    .where(and(tenantWhere(schema.mlsPatterns, scope), eq(schema.mlsPatterns.enabled, true)))
    .orderBy(schema.mlsPatterns.type, schema.mlsPatterns.patternKey);
}
