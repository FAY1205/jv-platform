// Shared rule for the admin lead-edit dialog's partner select (mirrors the server
// guard in editLead / CannotUnassignRoutedLeadError). Unassign only clears the
// additive manual overlay; PRN-05 forbids nulling the immutable pipeline snapshot,
// so a lead that has a pipeline-snapshot owner can never be made owner-less. The
// dialog offers "Unassigned" only when it would actually succeed.

export interface UnassignInput {
  /** The lead currently has an effective owner (manual overlay ?? pipeline snapshot). */
  hasEffectiveOwner: boolean;
  /** The effective owner comes from a manual overlay (assignment.manual). */
  manual: boolean;
  /** A pipeline-snapshot partner sits underneath the overlay (assignment.original). */
  hasOriginal: boolean;
}

/** Whether the partner select should offer "Unassigned" for this lead. False when a
 *  pipeline-snapshot owner exists (unassign would 409) — the admin uses "Revert to
 *  original routing" in that case. */
export function offersUnassign({ hasEffectiveOwner, manual, hasOriginal }: UnassignInput): boolean {
  // partnerId !== null (a pipeline snapshot owner) as seen from the client detail:
  //   overlay present → it's exposed as assignment.original;
  //   no overlay      → the effective owner IS the snapshot partner.
  const hasPipelineOwner = manual ? hasOriginal : hasEffectiveOwner;
  return !hasPipelineOwner;
}
