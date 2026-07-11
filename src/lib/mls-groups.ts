// WS-6 Rules: group MLS filter patterns by effect for the admin phrases card. Pure
// partition + order — keep-override phrases are presented BEFORE disqualifiers because
// they win (MLS-02: the pipeline engine checks overrides before disqualifiers). Copy
// (titles/hints) lives in mls-phrases.tsx; this module owns only the precedence-bearing order.

export type MlsEffect = "keep_override" | "disqualify";

export interface MlsGroup<T> {
  effect: MlsEffect;
  patterns: T[];
}

// Keep-override first (it beats disqualify), then disqualify. Input order is preserved
// within each group (callers pre-sort by patternKey), and empty groups are omitted.
// NOTE: this list must cover every value of patternTypeEnum (src/db/schema.ts). If a
// third MLS effect is ever added, add it here too — a pattern whose type is absent from
// EFFECT_ORDER would silently vanish from the admin Rules screen. The MlsEffect type
// bound makes the coupling fail typecheck at the call site if the enum widens.
const EFFECT_ORDER: readonly MlsEffect[] = ["keep_override", "disqualify"];

export function groupMlsPatterns<T extends { type: MlsEffect }>(patterns: T[]): MlsGroup<T>[] {
  return EFFECT_ORDER.map((effect) => ({
    effect,
    patterns: patterns.filter((p) => p.type === effect),
  })).filter((g) => g.patterns.length > 0);
}
