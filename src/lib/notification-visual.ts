// Maps an in-app notification `type` to a visual tone. The full roster and where each type
// is created (WP-NF1 D6 — this comment previously listed four of the seven and attributed
// them all to outbox.ts):
//   src/modules/notify/outbox.ts        → new_leads · hot_leads · run_summary ·
//                                         status_change · assigned_lead
//   src/modules/notify/task-reminders.ts → task_due · task_reminder_orphaned
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
};

export function notificationTone(type: string): NotificationTone {
  return TONE_BY_TYPE[type] ?? "neutral";
}
