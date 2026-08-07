import { createHash } from "node:crypto";
import { SCORING_SCHEME, SCORING_VERSION } from "../pipeline/score";

// ─────────────────────────────────────────────────────────────────────────────
// Rules snapshot (DM-08). Every run stores a hash + snapshot of the rule set it
// used (MLS patterns, recodes, coverage, source-profile version, scoring scheme) so
// past runs stay reproducible and the golden file can be pinned when rules evolve.
// Deterministic and ORDER-INDEPENDENT: the same rule set hashes identically
// regardless of row order. Only output-affecting fields are hashed (labels excluded).
// ─────────────────────────────────────────────────────────────────────────────

export interface RulesSnapshotInput {
  sourceProfile: { id: string; version: number };
  mlsPatterns: readonly { id: string; type: string; regex: string; flags?: string }[];
  stateRules: readonly { state: string; partnerId: string }[];
  zipCoverage: readonly { zip5: string; partnerId: string }[];
  /** Scoring scheme version (SCR / DM-08). Defaults to the code-pinned SCORING_VERSION. */
  scoringVersion?: string;
}

export interface RulesSnapshotShape {
  sourceProfile: { id: string; version: number };
  mlsPatterns: { id: string; type: string; regex: string; flags: string }[];
  stateRules: { state: string; partnerId: string }[];
  zipCoverage: { zip5: string; partnerId: string }[];
  scoringVersion: string;
  /** Content digest of the scoring scheme (see scoringDigest below). */
  scoringDigest: string;
}

// DM-08: pin the scheme by CONTENT, not a hand-maintained label — an edited point
// table must change the rulesHash even if nobody bumps SCORING_VERSION.
// First 16 hex chars of sha256 over the serialized scheme (same idiom as the
// snapshot hash itself).
function scoringDigest(): string {
  return createHash("sha256").update(JSON.stringify(SCORING_SCHEME)).digest("hex").slice(0, 16);
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
    scoringVersion: input.scoringVersion ?? SCORING_VERSION,
    scoringDigest: scoringDigest(),
  };

  const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return { hash, snapshot };
}
