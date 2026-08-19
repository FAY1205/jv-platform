// Maps an in-app notification `type` to a visual tone. The full roster and where each type
// is created (WP-NF1 D6 — this comment previously listed four of the seven and attributed
// them all to outbox.ts):
//   src/modules/notify/outbox.ts        → new_leads · hot_leads · run_summary ·
//                                         status_change · assigned_lead
//   src/modules/notify/task-reminders.ts → task_due · task_reminder_orphaned
//   src/modules/notify/events.ts         → task_assigned · partner_note ·
//                                         import_result · partner_activated  (WP-NF2 NTF-11)
// Pure, so it's unit-tested independently of the icon JSX. Unknown types fall back to
// neutral so a new server-side type never renders blank.
//
// PRN-14: the tone is NEVER the sole carrier — NotificationTypeIcon pairs it with a distinct
// icon SHAPE and marks the tile aria-hidden, and every notification row renders the title
// (and body) as text beside it.

export type NotificationTone = "route" | "success" | "info" | "neutral" | "hot";

const TONE_BY_TYPE: Record<string, NotificationTone> = {
  new_leads: "route",
  assigned_lead: "route",
  run_summary: "success",
  status_change: "info",
  hot_leads: "hot",
  // A due-task nudge is activity about the recipient's own committed work — the same
  // "something happened, go look" register as status_change, so it shares the info family
  // and its activity-pulse glyph.
  task_due: "info",
  // The undeliverable-reminder heads-up (C-14) stays NEUTRAL rather than borrowing the hot
  // tone: `hot` is the hot-LEAD target mark everywhere else in the app, and reusing it for an
  // ops warning would make a routing problem read as a sales opportunity. Neutral is the
  // shared "system notice" bell; the title ("A task reminder couldn't be delivered") carries
  // the meaning, per PRN-14. Mapped EXPLICITLY, not left to the fallback, so the decision is
  // visible here rather than implied by absence.
  task_reminder_orphaned: "neutral",

  // ── WP-NF2 NTF-11. Every one mapped EXPLICITLY (never left to the fallback) so the choice
  // is visible here rather than implied by absence, and every one reuses an existing AA-gated
  // tone — a new type is not a reason for a new colour family (PRN-14).
  //
  // Work arriving in someone's queue is the same event as a lead arriving in it, so
  // task_assigned joins new_leads/assigned_lead in the ROUTE family and inherits its
  // arrow-into-tray glyph: the shape already means "this landed with you".
  task_assigned: "route",
  // A partner note is activity on a lead someone else is working — the "something happened,
  // go look" register status_change occupies, and the same activity-pulse glyph.
  partner_note: "info",
  // ONE tone for both outcomes, because success and failure share one `type` STRING and the
  // tile is keyed on the type, not the payload. NEUTRAL is the honest choice: `success` would
  // put a green tick on "Import failed: …", and the warn/`hot` family is the hot-LEAD target
  // mark everywhere else in the app (reusing it would make an ops problem read as a sales
  // opportunity — the exact reasoning that made task_reminder_orphaned neutral). The bell
  // glyph is the shared system-notice shape; the TITLE, which always begins either "Import
  // {ref} processed" or "Import failed: …", carries the outcome (PRN-14).
  import_result: "neutral",
  // A partner finishing onboarding is a completed milestone — the one genuinely celebratory
  // event of the four, and the same register as run_summary's completed run.
  partner_activated: "success",
};

export function notificationTone(type: string): NotificationTone {
  return TONE_BY_TYPE[type] ?? "neutral";
}
