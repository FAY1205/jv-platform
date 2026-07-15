import { US_STATE_DATA } from "@/lib/us-states";
import type { StateCoverage } from "./map";

// ─────────────────────────────────────────────────────────────────────────────
// Portal territory view model (WP-F.3, PTL). PURE. Scoped to ONE partner: the
// partner's own states carry their identity (name + PR-ref + color, PRN-14); EVERY
// other state is anonymized (null name/ref/color) so a partner can never see which
// states other partners cover (PRN-08). No coverage-gap hatch in the portal — gaps
// are an admin concern; here a non-owned state is simply "not yours".
// ─────────────────────────────────────────────────────────────────────────────

export interface PartnerTerritoryInput {
  ownStates: readonly string[]; // state codes this partner owns (from state_rules)
  partner: { id: string; name: string; refId: string; color: string };
}

export interface PartnerTerritory {
  states: StateCoverage[];
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
  return {
    states,
    ownStateCount,
    partner: { name: input.partner.name, refId: input.partner.refId, color: input.partner.color },
  };
}
