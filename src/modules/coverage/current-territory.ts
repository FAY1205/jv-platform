import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";

// The ONE definition of a partner's CURRENT territory (audit F-3 / VCF-2.1). The currency
// predicate — coverage zips whose version is still OPEN (effectiveTo IS NULL; coverage is
// versioned per DM-06) plus the partner's state rules — was written independently at three
// call sites (partners territoryOf, deactivation, portal partnerTerritory). A change to that
// predicate missed at one site silently disagrees about who owns a ZIP, so every "what does
// this partner own right now" read goes through here.

type Db = PostgresJsDatabase<typeof schema>;
/** The db, or an open transaction (deactivation runs inside one). */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * A partner's current territory. Returns full rows (not just strings): deactivation must
 * re-version the exact coverage rows (id/county/region/version), while display callers map to
 * `.state` / `.zip5`. Ordered by state / zip5 for deterministic output. Tenant-scoped (PRN-08).
 */
export async function currentTerritoryQuery(exec: Executor, scope: ScopeContext, partnerId: string) {
  // Sequential (not Promise.all): deactivation passes an open transaction, whose single
  // reserved connection processes one query at a time. Two small reads — the cost is trivial.
  const stateRules = await exec
    .select({ id: schema.stateRules.id, state: schema.stateRules.state })
    .from(schema.stateRules)
    .where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, partnerId)))
    .orderBy(schema.stateRules.state);
  const coverageZips = await exec
    .select()
    .from(schema.coverageZips)
    .where(
      and(
        tenantWhere(schema.coverageZips, scope),
        eq(schema.coverageZips.partnerId, partnerId),
        isNull(schema.coverageZips.effectiveTo),
      ),
    )
    .orderBy(schema.coverageZips.zip5);
  return { stateRules, coverageZips };
}
