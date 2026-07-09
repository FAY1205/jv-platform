// ACT-04: which audited actions are security-relevant (highlighted in the admin
// activity view) vs routine data edits. PURE. The admin activity badge and any
// "security only" filter derive from this single source of truth.

export type ActivityCategory = "security" | "data";

const SECURITY_PREFIXES = ["mls_pattern.", "source_profile.", "auth."];
const SECURITY_MARKERS = ["deactivated", "coverage", "voided", "revoked", "note.edited"];

export function categorizeActivity(action: string): ActivityCategory {
  const a = action.toLowerCase();
  if (SECURITY_PREFIXES.some((p) => a.startsWith(p))) return "security";
  if (SECURITY_MARKERS.some((m) => a.includes(m))) return "security";
  return "data";
}
