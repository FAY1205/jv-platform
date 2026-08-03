import type { PartnerInput, CountyCoverage } from "./map";

// ─────────────────────────────────────────────────────────────────────────────
// County-coverage view model (WP-E, owner note #6). PURE — no I/O; the zip→county
// resolver is injected so this is fully testable with a fixture (PRN-01).
//
// A partner's ZIP coverage is entered as bare ZIPs. To color the COUNTY a partner
// covers (rather than tinting the whole state), each covered ZIP is resolved to its
// county FIPS and the county is assigned to the partner who owns the PLURALITY of the
// county's covered ZIPs (deterministic tiebreak by partner ref). A county with any
// ZIP coverage overrides the state fallback for that county; counties with none fall
// back to state ownership in the map component.
// ─────────────────────────────────────────────────────────────────────────────

export interface CountyZipInput {
  zip5: string;
  partnerId: string;
}

export function buildCountyCoverage(
  zipRows: readonly CountyZipInput[],
  partners: readonly PartnerInput[],
  zipToCounty: (zip5: string) => string | null,
): CountyCoverage[] {
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  // county FIPS → (partnerId → number of that partner's ZIPs in the county)
  const perCounty = new Map<string, Map<string, number>>();
  for (const row of zipRows) {
    if (!partnerById.has(row.partnerId)) continue; // ignore ZIPs of unknown/deleted partners
    const fips = zipToCounty(row.zip5);
    if (!fips) continue; // ZIP not in the crosswalk — can't place it in a county
    let counts = perCounty.get(fips);
    if (!counts) {
      counts = new Map();
      perCounty.set(fips, counts);
    }
    counts.set(row.partnerId, (counts.get(row.partnerId) ?? 0) + 1);
  }

  const out: CountyCoverage[] = [];
  for (const [fips, counts] of perCounty) {
    // Winner = most ZIPs in the county; ties broken by the lower partner ref (deterministic).
    let winnerId: string | null = null;
    let winnerN = 0;
    for (const [pid, n] of counts) {
      const p = partnerById.get(pid)!;
      if (n > winnerN || (n === winnerN && winnerId !== null && p.refId.localeCompare(partnerById.get(winnerId)!.refId) < 0)) {
        winnerId = pid;
        winnerN = n;
      }
    }
    if (!winnerId) continue;
    const p = partnerById.get(winnerId)!;
    out.push({ fips, partnerId: p.id, partnerName: p.name, refId: p.refId, color: p.color });
  }

  // Stable, deterministic order (PRN-15) — by FIPS.
  return out.sort((a, b) => a.fips.localeCompare(b.fips));
}
