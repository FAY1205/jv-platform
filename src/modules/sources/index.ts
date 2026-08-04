export * from "./types";
export {
  normalizeHeader,
  computeSignature,
  diffHeaders,
  detectProfile,
  createNextVersion,
  type HeaderDiff,
  type DetectStatus,
  type DetectResult,
} from "./signature";
export { applyProfile, findRowErrors, type AppliedRow } from "./apply";
export {
  LEAD_SOURCE_1_PROFILE,
  SEED_SOURCE_PROFILES,
  // Retired formats (WP-LS1) — not seeded; test/tooling vehicles only.
  GENERIC_PROFILE,
  INVESTORFUSE_PROFILE,
} from "./seed-profiles";
export {
  getTransform,
  stripSkipTrace,
  transformLeadSource1,
  type ProfileTransform,
} from "./transforms";
