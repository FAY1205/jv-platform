// CVG-01: diff a partner's newly-entered coverage against the current coverage
// map. The entry is the partner's COMPLETE set for that dimension (per-partner
// full replace): a ZIP they currently own but omit is a removal; a ZIP owned by
// another partner is a reassignment. PURE — the caller applies it transactionally.

export interface Reassignment {
  zip: string;
  fromPartnerId: string;
}

export interface CoverageDiff {
  /** Entered ZIPs not covered by anyone → insert. */
  add: string[];
  /** Entered ZIPs currently owned by a DIFFERENT partner → close theirs, insert ours. */
  reassign: Reassignment[];
  /** Entered ZIPs already owned by this partner → no change. */
  keep: string[];
  /** This partner's current ZIPs that were omitted → close. */
  remove: string[];
}

/**
 * @param entered   normalized ZIPs the owner assigned to this partner (deduped)
 * @param current   current coverage: zip → owning partnerId (effective_to IS NULL)
 * @param partnerId the partner being edited
 */
export function diffPartnerCoverage(
  entered: readonly string[],
  current: ReadonlyMap<string, string>,
  partnerId: string,
): CoverageDiff {
  const add: string[] = [];
  const reassign: Reassignment[] = [];
  const keep: string[] = [];
  const enteredSet = new Set(entered);

  for (const zip of entered) {
    const owner = current.get(zip);
    if (owner === undefined) add.push(zip);
    else if (owner === partnerId) keep.push(zip);
    else reassign.push({ zip, fromPartnerId: owner });
  }

  const remove: string[] = [];
  for (const [zip, owner] of current) {
    if (owner === partnerId && !enteredSet.has(zip)) remove.push(zip);
  }

  return { add, reassign, keep, remove };
}
