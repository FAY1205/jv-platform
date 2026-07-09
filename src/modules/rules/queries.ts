import { and, count, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";

// CVG-02 read side for the Rules area. Admin-only surface; all reads scoped (PRN-08).

export interface MlsPatternRow {
  id: string;
  patternKey: string;
  type: "disqualify" | "keep_override";
  regex: string;
  flags: string;
  label: string;
  enabled: boolean;
}
export interface CoverageSummary {
  zipCount: number;
  stateRules: { state: string; partnerName: string; partnerRef: string; color: string }[];
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
    .where(tenantWhere(schema.mlsPatterns, scope))
    .orderBy(schema.mlsPatterns.type, schema.mlsPatterns.patternKey);
}

export async function coverageSummary(scope: ScopeContext): Promise<CoverageSummary> {
  const db = getDb();
  const [zips] = await db
    .select({ n: count() })
    .from(schema.coverageZips)
    .where(and(tenantWhere(schema.coverageZips, scope), isNull(schema.coverageZips.effectiveTo)));
  const states = await db
    .select({ state: schema.stateRules.state, partnerName: schema.partners.name, partnerRef: schema.partners.refId, color: schema.partners.color })
    .from(schema.stateRules)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.stateRules.partnerId))
    .where(tenantWhere(schema.stateRules, scope))
    .orderBy(schema.stateRules.state);
  return { zipCount: Number(zips?.n ?? 0), stateRules: states };
}
