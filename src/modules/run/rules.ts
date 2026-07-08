import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { buildCoverage, type Coverage } from "../pipeline/assign";
import type { MlsPattern } from "../pipeline/mls";
import type { CampaignRecode } from "../pipeline/recode";

// ─────────────────────────────────────────────────────────────────────────────
// Load the tenant's live rule set for a run (WP-020): MLS patterns, recodes, and the
// CURRENT coverage (state fallbacks + zip coverage). All reads through the scope guard
// (PRN-08). Returns both the engine inputs and the snapshot parts (DM-08).
// ─────────────────────────────────────────────────────────────────────────────

export interface RunRulesBundle {
  rules: { mlsPatterns: MlsPattern[]; recodes: CampaignRecode[]; coverage: Coverage };
  snapshotParts: {
    mlsPatterns: { id: string; type: string; regex: string; flags: string }[];
    recodes: { matchPattern: string; code: string }[];
    stateRules: { state: string; partnerId: string }[];
    zipCoverage: { zip5: string; partnerId: string }[];
  };
}

export async function loadRunRules(scope: ScopeContext): Promise<RunRulesBundle> {
  const db = getDb();
  const [patternRows, recodeRows, stateRows, zipRows] = await Promise.all([
    db.select().from(schema.mlsPatterns).where(and(tenantWhere(schema.mlsPatterns, scope), eq(schema.mlsPatterns.enabled, true))),
    db.select({ matchPattern: schema.campaignRecodes.matchPattern, code: schema.campaignRecodes.code }).from(schema.campaignRecodes).where(tenantWhere(schema.campaignRecodes, scope)),
    db.select({ state: schema.stateRules.state, partnerId: schema.stateRules.partnerId }).from(schema.stateRules).where(tenantWhere(schema.stateRules, scope)),
    db.select({ zip5: schema.coverageZips.zip5, partnerId: schema.coverageZips.partnerId }).from(schema.coverageZips).where(and(tenantWhere(schema.coverageZips, scope), isNull(schema.coverageZips.effectiveTo))),
  ]);

  const mlsPatterns: MlsPattern[] = patternRows.map((p) => ({ id: p.patternKey, type: p.type, regex: p.regex, flags: p.flags, label: p.label }));
  const recodes: CampaignRecode[] = recodeRows;
  const stateRules = stateRows.map((s) => ({ state: s.state, partnerId: s.partnerId }));
  const zipCoverage = zipRows.map((z) => ({ zip5: z.zip5, partnerId: z.partnerId }));

  return {
    rules: { mlsPatterns, recodes, coverage: buildCoverage(zipCoverage, stateRules) },
    snapshotParts: {
      mlsPatterns: patternRows.map((p) => ({ id: p.patternKey, type: p.type, regex: p.regex, flags: p.flags })),
      recodes,
      stateRules,
      zipCoverage,
    },
  };
}
