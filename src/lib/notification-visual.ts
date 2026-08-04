// Maps an in-app notification `type` (created in src/modules/notify/outbox.ts:
// new_leads · assigned_lead · run_summary · status_change) to a visual tone. Pure,
// so it's unit-tested independently of the icon JSX. Unknown types fall back to
// neutral so a new server-side type never renders blank.

export type NotificationTone = "route" | "success" | "info" | "neutral" | "hot";

const TONE_BY_TYPE: Record<string, NotificationTone> = {
  new_leads: "route",
  assigned_lead: "route",
  run_summary: "success",
  status_change: "info",
  hot_leads: "hot",
};

export function notificationTone(type: string): NotificationTone {
  return TONE_BY_TYPE[type] ?? "neutral";
}
