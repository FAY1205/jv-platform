import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { diffPartnerCoverage } from "./diff";
import { PartnerNotFoundError } from "../partners/commands";

// ─────────────────────────────────────────────────────────────────────────────
// Per-partner coverage entry (CVG-01). The owner types the ZIPs (and states) a
// partner covers; this applies the entry as that partner's COMPLETE set. ZIP
// coverage is versioned (DM-06): changed current rows are closed (effective_to)
// and new rows opened — history is never edited (DM-08). State rules aren't
// versioned in the schema — they're upserted/deleted in place. PRN-05: existing
// lead assignments are untouched; only future runs change. Every apply is audited.
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverageChange {
  addedZips: number;
  reassignedZips: number;
  removedZips: number;
  statesSet: number;
  removedStates: number;
}

/** WP-C (owner note #1): a single conflicting territory — a ZIP or state the entry claims
 *  but which another (non-deleted) partner currently owns. Surfaced so the owner can go edit
 *  that partner first, rather than silently stealing it. */
export interface CoverageConflict {
  kind: "zip" | "state";
  value: string;
  ownerPartnerId: string;
  ownerRefId: string;
  ownerName: string;
}

/** WP-C: thrown when an entry would take territory from another partner. The coverage save is
 *  rejected as a whole (no partial apply) so the owner resolves the overlap explicitly. */
export class CoverageConflictError extends Error {
  constructor(public readonly conflicts: CoverageConflict[]) {
    super("Some of this coverage is already assigned to another partner.");
    this.name = "CoverageConflictError";
  }
}

type CoverageTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function setPartnerCoverage(
  scope: ScopeContext,
  partnerId: string,
  input: { zips: string[]; states: string[] },
): Promise<CoverageChange> {
  return getDb().transaction((tx) => applyCoverageTx(tx, scope, partnerId, input));
}

/**
 * The coverage-apply core, running inside a caller-supplied transaction (so a partner create +
 * its first coverage are one atomic unit — no orphan partner if coverage conflicts). Pass
 * `knownRefId` for a just-created partner to skip the existence lookup.
 *
 * WP-C: an entered ZIP or state owned by ANOTHER partner is a hard conflict — the whole apply is
 * rejected (CoverageConflictError), never silently reassigned. Re-entering territory this partner
 * already owns is fine (a keep / no-op).
 */
export async function applyCoverageTx(
  tx: CoverageTx,
  scope: ScopeContext,
  partnerId: string,
  input: { zips: string[]; states: string[] },
  knownRefId?: string,
): Promise<CoverageChange> {
  let refId = knownRefId;
  if (!refId) {
    const [partner] = await tx
      .select({ id: schema.partners.id, refId: schema.partners.refId })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, partnerId), isNull(schema.partners.deletedAt)));
    if (!partner) throw new PartnerNotFoundError();
    refId = partner.refId;
  }

  const now = new Date();

  // ── ZIP coverage (versioned) ──
  const currentRows = await tx
    .select({ zip5: schema.coverageZips.zip5, partnerId: schema.coverageZips.partnerId })
    .from(schema.coverageZips)
    .where(and(tenantWhere(schema.coverageZips, scope), isNull(schema.coverageZips.effectiveTo)));
  const currentMap = new Map(currentRows.map((r) => [r.zip5, r.partnerId] as const));
  const zdiff = diffPartnerCoverage(input.zips, currentMap, partnerId);

  // ── State ownership (for conflict detection + apply) ──
  const curStates = await tx
    .select({ state: schema.stateRules.state, partnerId: schema.stateRules.partnerId })
    .from(schema.stateRules)
    .where(tenantWhere(schema.stateRules, scope));
  const stateOwner = new Map(curStates.map((r) => [r.state, r.partnerId] as const));
  const stateConflicts = input.states.filter((s) => {
    const owner = stateOwner.get(s);
    return owner !== undefined && owner !== partnerId;
  });

  // ── WP-C conflict gate: a ZIP the diff wants to REASSIGN, or a state owned by another
  // partner, blocks the entire save. Resolve owner names for a helpful message.
  if (zdiff.reassign.length > 0 || stateConflicts.length > 0) {
    const ownerIds = [...new Set([...zdiff.reassign.map((r) => r.fromPartnerId), ...stateConflicts.map((s) => stateOwner.get(s)!)])];
    const owners = await tx
      .select({ id: schema.partners.id, refId: schema.partners.refId, name: schema.partners.name })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), inArray(schema.partners.id, ownerIds)));
    const byId = new Map(owners.map((o) => [o.id, o] as const));
    const describe = (id: string) => byId.get(id) ?? { refId: "?", name: "another partner" };
    const conflicts: CoverageConflict[] = [
      ...zdiff.reassign.map((r) => {
        const o = describe(r.fromPartnerId);
        return { kind: "zip" as const, value: r.zip, ownerPartnerId: r.fromPartnerId, ownerRefId: o.refId, ownerName: o.name };
      }),
      ...stateConflicts.map((s) => {
        const oid = stateOwner.get(s)!;
        const o = describe(oid);
        return { kind: "state" as const, value: s, ownerPartnerId: oid, ownerRefId: o.refId, ownerName: o.name };
      }),
    ];
    throw new CoverageConflictError(conflicts);
  }

  {
    // No conflicts: the only ZIP writes are this partner's own additions/removals.
    const toClose = [...zdiff.remove];
    const toInsert = [...zdiff.add];

    // Next version per affected zip = max existing version (incl. closed) + 1.
    const maxVer = new Map<string, number>();
    const affected = [...new Set([...toClose, ...toInsert])];
    if (affected.length > 0) {
      const vrows = await tx
        .select({ zip5: schema.coverageZips.zip5, v: sql<number>`max(${schema.coverageZips.version})` })
        .from(schema.coverageZips)
        .where(and(tenantWhere(schema.coverageZips, scope), inArray(schema.coverageZips.zip5, affected)))
        .groupBy(schema.coverageZips.zip5);
      for (const r of vrows) maxVer.set(r.zip5, Number(r.v));
    }

    if (toClose.length > 0) {
      await tx
        .update(schema.coverageZips)
        .set({ effectiveTo: now })
        .where(and(tenantWhere(schema.coverageZips, scope), inArray(schema.coverageZips.zip5, toClose), isNull(schema.coverageZips.effectiveTo)));
    }
    for (const zip of toInsert) {
      await tx.insert(schema.coverageZips).values({
        tenantId: scope.tenantId,
        zip5: zip,
        partnerId,
        version: (maxVer.get(zip) ?? 0) + 1,
        effectiveFrom: now,
        effectiveTo: null,
      });
    }

    // ── State rules (upsert to this partner; drop this partner's omitted states).
    // curStates was already read above for conflict detection; conflicts are ruled out
    // here, so every upsert lands on either a new row or one this partner already owns.
    for (const st of input.states) {
      await tx
        .insert(schema.stateRules)
        .values({ tenantId: scope.tenantId, state: st, partnerId })
        .onConflictDoUpdate({ target: [schema.stateRules.tenantId, schema.stateRules.state], set: { partnerId } });
    }
    const enteredStates = new Set(input.states);
    const removeStates = curStates.filter((r) => r.partnerId === partnerId && !enteredStates.has(r.state)).map((r) => r.state);
    if (removeStates.length > 0) {
      await tx
        .delete(schema.stateRules)
        .where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, partnerId), inArray(schema.stateRules.state, removeStates)));
    }

    const change: CoverageChange = {
      addedZips: zdiff.add.length,
      reassignedZips: zdiff.reassign.length,
      removedZips: zdiff.remove.length,
      statesSet: input.states.length,
      removedStates: removeStates.length,
    };

    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "partner.coverage_updated",
      entityType: "partner",
      entityRef: refId,
      before: { currentZips: currentRows.filter((r) => r.partnerId === partnerId).length },
      after: change as unknown as Record<string, unknown>,
      traceId: globalThis.crypto.randomUUID(),
    });

    return change;
  }
}
