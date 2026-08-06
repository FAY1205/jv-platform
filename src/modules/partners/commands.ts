import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { nextPartnerNumber } from "./refs";
import { pickPartnerColor } from "./colors";
import { HOUSE_COLOR } from "@/lib/tokens/tokens";
import { formatPartnerRef } from "@/db/ref-ids";
import type { PartnerCreateInput, PartnerUpdateInput, DeactivateInput } from "./schema";
import type { Territory } from "./queries";
import { currentTerritoryQuery } from "@/modules/coverage/current-territory";

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

type PartnerTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Create a partner inside a caller-supplied transaction (next PR-### + first unused locked
 * color, status not_invited). WP-C: extracted so a partner + its first coverage can be created
 * atomically (createPartnerWithCoverage) — a coverage conflict then rolls the partner back too,
 * instead of leaving an orphan that a retry would duplicate.
 */
export async function createPartnerTx(
  tx: PartnerTx,
  scope: ScopeContext,
  input: PartnerCreateInput,
): Promise<CreatedPartner> {
  // Serialize ref/color allocation per tenant (ING-06 pattern) so two concurrent
  // creates can't collide on PR-### or a color.
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
}

/** Create a partner: next PR-### + first unused locked color, status not_invited. */
export async function createPartner(
  scope: ScopeContext,
  input: PartnerCreateInput,
): Promise<CreatedPartner> {
  return getDb().transaction((tx) => createPartnerTx(tx, scope, input));
}

// WP-D (ADR-0037): the tenant's own "house" territory — a partner row flagged is_house, with a
// fixed identity (no PR-### number, reserved graphite color, no contact). It never gets invited or
// deactivated; the admin only edits its coverage. Modeled as a partner so it routes and colors maps
// with zero pipeline special-casing (ASN-02).
export const HOUSE_REF = "HOUSE";
export const HOUSE_NAME = "My Territory";

/**
 * Return the tenant's house partner, creating it on first use. Idempotent: the per-tenant advisory
 * lock + the `is_house` partial unique index guarantee at most one. Created lazily (not seeded) so
 * existing and new tenants get it the same way — the first time the admin sets up their territory.
 */
export async function ensureHousePartner(scope: ScopeContext): Promise<CreatedPartner & { name: string }> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope.tenantId + ":partner"})::bigint)`);
    const [existing] = await tx
      .select({ id: schema.partners.id, refId: schema.partners.refId, color: schema.partners.color, name: schema.partners.name })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.isHouse, true), isNull(schema.partners.deletedAt)));
    if (existing) return existing;

    const [created] = await tx
      .insert(schema.partners)
      .values({
        tenantId: scope.tenantId,
        refId: HOUSE_REF,
        name: HOUSE_NAME,
        email: null,
        color: HOUSE_COLOR,
        isHouse: true,
        status: "not_invited",
      })
      .returning({ id: schema.partners.id });

    await audit(tx, scope, "partner.house_created", HOUSE_REF, null, { name: HOUSE_NAME });
    return { id: created.id, refId: HOUSE_REF, color: HOUSE_COLOR, name: HOUSE_NAME };
  });
}

/** Thrown when an operation that only applies to real partners targets the house row. */
export class HouseNotAllowedError extends Error {
  constructor(message = "This action doesn't apply to your own territory.") {
    super(message);
    this.name = "HouseNotAllowedError";
  }
}

/**
 * Update a partner's contact details inside a caller-supplied transaction. WP-C: extracted so an
 * edit's contact + coverage are one atomic unit (updatePartnerWithCoverage) — a coverage conflict
 * then rolls the contact change back too, instead of leaving contact saved but coverage rejected.
 * Color + status are not editable here.
 */
export async function updatePartnerTx(
  tx: PartnerTx,
  scope: ScopeContext,
  partnerId: string,
  patch: PartnerUpdateInput,
): Promise<void> {
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
}

/** Update a partner's contact details. Color + status are not editable here. */
export async function updatePartner(
  scope: ScopeContext,
  partnerId: string,
  patch: PartnerUpdateInput,
): Promise<void> {
  await getDb().transaction((tx) => updatePartnerTx(tx, scope, partnerId, patch));
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
    if (partner.isHouse) throw new HouseNotAllowedError("Your own territory can't be deactivated.");
    if (partner.deletedAt || partner.status === "revoked") throw new AlreadyDeactivatedError();

    const { stateRules: states, coverageZips: zips } = await currentTerritoryQuery(tx, scope, partnerId);

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
