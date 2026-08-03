import { US_STATE_DATA } from "@/lib/us-states";
import type { StateCoverage, CountyCoverage } from "./map";
import { buildCountyCoverage } from "./county";

// ─────────────────────────────────────────────────────────────────────────────
// Portal territory view model (WP-F.3, PTL). PURE. Scoped to ONE partner: the
// partner's own states carry their identity (name + PR-ref + color, PRN-14); EVERY
// other state is anonymized (null name/ref/color) so a partner can never see which
// states other partners cover (PRN-08). No coverage-gap hatch in the portal — gaps
// are an admin concern; here a non-owned state is simply "not yours".
// ─────────────────────────────────────────────────────────────────────────────

export interface PartnerTerritoryInput {
  ownStates: readonly string[]; // state codes this partner owns (from state_rules)
  /** WP-E: ZIP5s this partner owns (from coverage_zips). Resolved to the partner's OWN counties
   *  (only theirs — no other partner's territory leaks, PRN-08). Omit for a state-only territory. */
  ownZips?: readonly string[];
  partner: { id: string; name: string; refId: string; color: string };
  /** Injected so this stays pure/testable (PRN-01). Required to produce counties. */
  zipToCounty?: (zip5: string) => string | null;
}

export interface PartnerTerritory {
  states: StateCoverage[];
  /** WP-E: the partner's own counties (via their ZIPs), colored in their color. */
  counties: CountyCoverage[];
  ownStateCount: number;
  partner: { name: string; refId: string; color: string };
}

export function buildPartnerTerritory(input: PartnerTerritoryInput): PartnerTerritory {
  const owned = new Set(input.ownStates);
  const states: StateCoverage[] = US_STATE_DATA.map((st) => {
    const mine = owned.has(st.code);
    return {
      code: st.code,
      name: st.name,
      partnerId: mine ? input.partner.id : null,
      partnerName: mine ? input.partner.name : null,
      refId: mine ? input.partner.refId : null,
      color: mine ? input.partner.color : null,
      leadCount: 0,
      gap: false,
    };
  });
  const ownStateCount = states.filter((s) => s.partnerId !== null).length;
  // Only THIS partner's ZIPs are passed, so every resolved county is unambiguously theirs.
  const counties =
    input.zipToCounty && input.ownZips && input.ownZips.length > 0
      ? buildCountyCoverage(
          input.ownZips.map((zip5) => ({ zip5, partnerId: input.partner.id })),
          [input.partner],
          input.zipToCounty,
        )
      : [];
  return {
    states,
    counties,
    ownStateCount,
    partner: { name: input.partner.name, refId: input.partner.refId, color: input.partner.color },
  };
}
