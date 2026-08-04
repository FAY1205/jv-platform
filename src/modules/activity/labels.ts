// ACT-01/04 (T6, owner testing note #9): plain-language labels for the activity
// trail. The audit_log stores machine action strings ("lead.manually_assigned");
// admins read sentences. PURE — the single source for both the action and the
// entity wording (PRN-15 spirit: never re-derive labels ad hoc in a page).

/** Every action the app writes today (writers: leads/notes/partners/rules/sources/
 *  run/retention command modules). Unknown actions fall back gracefully — a new
 *  writer never renders as a blank, just less polished. */
export const ACTION_LABELS: Record<string, string> = {
  "lead.edited": "Lead edited",
  "lead.manually_assigned": "Lead manually assigned",
  "lead.pii_purged": "Lead personal info purged",
  "note.edited": "Note edited",
  "partner.created": "Partner created",
  "partner.updated": "Partner details updated",
  "partner.invited": "Partner invited",
  "partner.deactivated": "Partner deactivated",
  "partner.coverage_updated": "Partner coverage updated",
  "partner.session_revoked": "Partner signed out of a device",
  "mls_pattern.updated": "MLS phrase rule updated",
  "source_profile.saved": "File format profile saved",
  "upload.voided": "Import voided",
};

/** Human label for an audit action; unknown values are prettified, never raw. */
export function activityActionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const words = action.replace(/[._]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : action;
}

export const ENTITY_LABELS: Record<string, string> = {
  lead: "Lead",
  lead_note: "Note",
  partner: "Partner",
  rule: "Rule",
  source_profile: "File format",
  trusted_device: "Device",
  upload: "Import",
};

/** Human label for an audit entity type ("upload" → "Import"). */
export function activityEntityLabel(entityType: string): string {
  const known = ENTITY_LABELS[entityType];
  if (known) return known;
  const words = entityType.replace(/[._]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : entityType;
}
