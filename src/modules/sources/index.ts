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
export { GENERIC_PROFILE, SEED_SOURCE_PROFILES } from "./seed-profiles";
