import { getDb } from "@/db";
import type { ScopeContext } from "@/lib/scope";
import { createPartnerTx, updatePartnerTx, type CreatedPartner } from "./commands";
import { applyCoverageTx, type CoverageChange } from "../coverage/commands";
import type { PartnerCreateInput, PartnerUpdateInput } from "./schema";

// WP-C (owner note #1): create or edit a partner AND set its coverage in ONE transaction, so a
// coverage rejection (an unrecognized token, or the hard territory-conflict) rolls the contact
// write back with it — no orphan on create, no "contact saved but coverage rejected" split on
// edit. Lives in its own module so it can import both leaf command modules without a cycle
// (coverage/commands already imports partners/commands).

export async function createPartnerWithCoverage(
  scope: ScopeContext,
  input: PartnerCreateInput,
  coverage: { zips: string[]; states: string[] },
): Promise<{ partner: CreatedPartner; change: CoverageChange }> {
  return getDb().transaction(async (tx) => {
    const partner = await createPartnerTx(tx, scope, input);
    // Pass the just-allocated refId so applyCoverageTx skips its partner-existence lookup.
    const change = await applyCoverageTx(tx, scope, partner.id, coverage, partner.refId);
    return { partner, change };
  });
}

export async function updatePartnerWithCoverage(
  scope: ScopeContext,
  partnerId: string,
  patch: PartnerUpdateInput,
  coverage: { zips: string[]; states: string[] },
): Promise<CoverageChange> {
  return getDb().transaction(async (tx) => {
    // updatePartnerTx throws PartnerNotFoundError if the partner is gone; applyCoverageTx re-checks
    // existence and throws CoverageConflictError on an overlap — either aborts the whole tx.
    await updatePartnerTx(tx, scope, partnerId, patch);
    return applyCoverageTx(tx, scope, partnerId, coverage);
  });
}
