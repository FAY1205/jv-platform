import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Rules snapshot (DM-08). Every run stores a hash + snapshot of the rule set it
// used (MLS patterns, recodes, coverage, source-profile version) so past runs stay
// reproducible and the golden file can be pinned when rules evolve. Deterministic
// and ORDER-INDEPENDENT: the same rule set hashes identically regardless of row
// order. Only output-affecting fields are hashed (labels are excluded).
// ─────────────────────────────────────────────────────────────────────────────

export interface RulesSnapshotInput {
  sourceProfile: { id: string; version: number };
  mlsPatterns: readonly { id: string; type: string; regex: string; flags?: string }[];
  stateRules: readonly { state: string; partnerId: string }[];
  zipCoverage: readonly { zip5: string; partnerId: string }[];
}

export interface RulesSnapshotShape {
  sourceProfile: { id: string; version: number };
  mlsPatterns: { id: string; type: string; regex: string; flags: string }[];
  stateRules: { state: string; partnerId: string }[];
  zipCoverage: { zip5: string; partnerId: string }[];
}

export interface RulesSnapshot {
  hash: string;
  snapshot: RulesSnapshotShape;
}

const byKey =
  <T>(key: (t: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

export function buildRulesSnapshot(input: RulesSnapshotInput): RulesSnapshot {
  const snapshot: RulesSnapshotShape = {
    sourceProfile: { id: input.sourceProfile.id, version: input.sourceProfile.version },
    mlsPatterns: input.mlsPatterns
      .map((p) => ({ id: p.id, type: p.type, regex: p.regex, flags: p.flags ?? "i" }))
      .sort(byKey((p) => p.id)),
    stateRules: input.stateRules
      .map((s) => ({ state: s.state, partnerId: s.partnerId }))
      .sort(byKey((s) => s.state)),
    zipCoverage: input.zipCoverage
      .map((z) => ({ zip5: z.zip5, partnerId: z.partnerId }))
      .sort(byKey((z) => z.zip5)),
  };

  const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return { hash, snapshot };
}
