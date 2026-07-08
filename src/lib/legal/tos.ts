// LGL-01: versioned Terms of Service + Privacy Policy. This is PLACEHOLDER text for
// build/test; the real documents are an owner deliverable before onboarding real
// partners (§12.8). Bump CURRENT_TOS_VERSION on any material change to force
// re-acceptance (acceptance is recorded per user+version in tos_acceptances).

export const CURRENT_TOS_VERSION = "2026-07-08";

export const TOS_TITLE = "Terms of Service & Privacy Policy";

export const TOS_SUMMARY =
  "By accessing this portal you agree to the Terms of Service and acknowledge the Privacy Policy. " +
  "Leads may contain consumer PII; contacting sellers is your responsibility and must comply with " +
  "applicable law (including TCPA/DNC). This is placeholder text pending the finalized documents.";

/** True when the user must (re-)accept: never accepted, or accepted an older version. */
export function needsTosAcceptance(
  acceptedVersion: string | null | undefined,
  currentVersion: string = CURRENT_TOS_VERSION,
): boolean {
  return acceptedVersion !== currentVersion;
}
