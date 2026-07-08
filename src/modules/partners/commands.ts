import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { nextPartnerNumber } from "./refs";
import { pickPartnerColor } from "./colors";
import { formatPartnerRef } from "@/db/ref-ids";
import type { PartnerCreateInput, PartnerUpdateInput, DeactivateInput } from "./schema";
import type { Territory } from "./queries";

// ADM-03 write side. All mutations are tenant-scoped (PRN-08), audited (DM-04/08),
// and transactional. PRN-05: historical lead assignments are NEVER touched — only
// the forward-looking rules tables (state_rules / coverage_zips) change, so a
// deactivation affects future runs only. ASN-02: reassignment is fully generic
// (any partner → any partner) — no per-partner special-casing.

export class PartnerNotFoundError extends Error {
  constructor() {
    super("Partner not found.");
    this.name = "PartnerNotFoundError";
  }
}
export class AlreadyDeactivatedError extends Error {
  constructor() {
    super("Partner is already deactivated.");
    this.name = "AlreadyDeactivatedError";
  }
}
export class ReassignmentRequiredError extends Error {
  constructor(public readonly territory: Territory) {
    super("This partner still owns territory — choose reassignment or Unmatched.");
    this.name = "ReassignmentRequiredError";
  }
}
export class InvalidReassignTargetError extends Error {
  constructor() {
    super("Choose a different, active partner to receive the territory.");
    this.name = "InvalidReassignTargetError";
  }
}

const audit = (
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  scope: ScopeContext,
  action: string,
  entityRef: string,
  before: unknown,
  after: unknown,
) =>
  tx.insert(schema.auditLog).values({
    tenantId: scope.tenantId,
    actorUserId: scope.userId,
    action,
    entityType: "partner",
    entityRef,
    before: before as Record<string, unknown>,
    after: after as Record<string, unknown>,
    traceId: globalThis.crypto.randomUUID(),
  });

export interface CreatedPartner {
  id: string;
  refId: string;
  color: string;
}

/** Create a partner: next JV-### + first unused locked color, status not_invited. */
export async function createPartner(
  scope: ScopeContext,
  input: PartnerCreateInput,
): Promise<CreatedPartner> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Serialize ref/color allocation per tenant (ING-06 pattern) so two concurrent
    // creates can't collide on JV-### or a color.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope.tenantId + ":partner"})::bigint)`);

    const existing = await tx
      .select({ refId: schema.partners.refId, color: schema.partners.color, deletedAt: schema.partners.deletedAt })
      .from(schema.partners)
      .where(tenantWhere(schema.partners, scope));

    const refId = formatPartnerRef(nextPartnerNumber(existing.map((e) => e.refId)));
    const usedColors = existing.filter((e) => !e.deletedAt).map((e) => e.color);
    const color = pickPartnerColor(usedColors);

    const [created] = await tx
      .insert(schema.partners)
      .values({
        tenantId: scope.tenantId,
        refId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        color,
        dealTerms: input.dealTerms ?? null,
        adminNotes: input.adminNotes ?? null,
        status: "not_invited",
      })
      .returning({ id: schema.partners.id });

    await audit(tx, scope, "partner.created", refId, null, { name: input.name, color });
    return { id: created.id, refId, color };
  });
}

/** Update a partner's contact details. Color + status are not editable here. */
export async function updatePartner(
  scope: ScopeContext,
  partnerId: string,
  patch: PartnerUpdateInput,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, partnerId), isNull(schema.partners.deletedAt)));
    if (!before) throw new PartnerNotFoundError();

    // Partial update: only fields explicitly provided change (undefined = no change).
    const set: Partial<typeof schema.partners.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.email !== undefined) set.email = patch.email;
    if (patch.phone !== undefined) set.phone = patch.phone;
    if (patch.dealTerms !== undefined) set.dealTerms = patch.dealTerms;
    if (patch.adminNotes !== undefined) set.adminNotes = patch.adminNotes;
    if (Object.keys(set).length === 0) return;

    await tx.update(schema.partners).set(set).where(eq(schema.partners.id, before.id));
    await audit(
      tx,
      scope,
      "partner.updated",
      before.refId,
      { name: before.name, email: before.email, phone: before.phone, dealTerms: before.dealTerms },
      set,
    );
  });
}

export interface DeactivateResult {
  partnerRef: string;
  movedStates: number;
  movedZips: number;
  mode: DeactivateInput["mode"] | "none";
  toPartnerRef?: string;
}

/**
 * Deactivate a partner (ADM-03). If they still own coverage, `decision` says where
 * it goes: reassign to another partner (a new coverage version) or route to
 * Unmatched. Historical lead assignments are untouched (PRN-05). Throws
 * ReassignmentRequiredError when territory exists but no decision was supplied.
 */
export async function deactivatePartner(
  scope: ScopeContext,
  partnerId: string,
  decision?: DeactivateInput,
): Promise<DeactivateResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [partner] = await tx
      .select()
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, partnerId)));
    if (!partner) throw new PartnerNotFoundError();
    if (partner.deletedAt || partner.status === "revoked") throw new AlreadyDeactivatedError();

    const states = await tx
      .select({ id: schema.stateRules.id, state: schema.stateRules.state })
      .from(schema.stateRules)
      .where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, partnerId)));
    const zips = await tx
      .select()
      .from(schema.coverageZips)
      .where(
        and(
          tenantWhere(schema.coverageZips, scope),
          eq(schema.coverageZips.partnerId, partnerId),
          isNull(schema.coverageZips.effectiveTo),
        ),
      );

    const hasTerritory = states.length > 0 || zips.length > 0;
    if (hasTerritory && !decision) {
      throw new ReassignmentRequiredError({ states: states.map((s) => s.state), zips: zips.map((z) => z.zip5) });
    }

    const now = new Date();
    let toPartnerRef: string | undefined;

    if (hasTerritory && decision) {
      if (decision.mode === "reassign") {
        const [target] = await tx
          .select({ id: schema.partners.id, refId: schema.partners.refId })
          .from(schema.partners)
          .where(
            and(
              tenantWhere(schema.partners, scope),
              eq(schema.partners.id, decision.toPartnerId),
              ne(schema.partners.id, partnerId),
              isNull(schema.partners.deletedAt),
            ),
          );
        if (!target) throw new InvalidReassignTargetError();
        toPartnerRef = target.refId;

        // State rules are not versioned (SEAM): repoint in place — future runs only.
        await tx
          .update(schema.stateRules)
          .set({ partnerId: target.id })
          .where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, partnerId)));

        // Coverage IS versioned (DM-06): close the current row, open a new version
        // for the target. Closing before inserting keeps one current row per zip.
        for (const z of zips) {
          await tx.update(schema.coverageZips).set({ effectiveTo: now }).where(eq(schema.coverageZips.id, z.id));
          await tx.insert(schema.coverageZips).values({
            tenantId: scope.tenantId,
            zip5: z.zip5,
            county: z.county,
            region: z.region,
            partnerId: target.id,
            version: z.version + 1,
            effectiveFrom: now,
            effectiveTo: null,
          });
        }
      } else {
        // Route to Unmatched: drop the state rules; close coverage with no successor.
        await tx
          .delete(schema.stateRules)
          .where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, partnerId)));
        for (const z of zips) {
          await tx.update(schema.coverageZips).set({ effectiveTo: now }).where(eq(schema.coverageZips.id, z.id));
        }
      }
    }

    await tx
      .update(schema.partners)
      .set({ status: "revoked", deletedAt: now })
      .where(eq(schema.partners.id, partner.id));

    const mode = hasTerritory && decision ? decision.mode : "none";
    await audit(
      tx,
      scope,
      "partner.deactivated",
      partner.refId,
      { status: partner.status },
      { status: "revoked", mode, movedStates: states.length, movedZips: zips.length, toPartnerRef },
    );

    return { partnerRef: partner.refId, movedStates: states.length, movedZips: zips.length, mode, toPartnerRef };
  });
}
