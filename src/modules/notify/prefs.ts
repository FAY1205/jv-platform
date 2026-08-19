import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";

// ─────────────────────────────────────────────────────────────────────────────
// Notification preferences (NTF-05 / SET-03). Per role, per event type: send email,
// show in-app, or both. Stored as ONE tenant settings row (key `notification_prefs`)
// and always resolved against defaults so a missing/partial value can't drop a
// notification. Transactional auth email is separate and always on (never here).
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;
export const NOTIFICATION_PREFS_KEY = "notification_prefs";

export type NotifRole = "admin" | "partner";

/** Phase C: preference buckets are per-STREAM, not per-tier — every admin-stream role
 *  (admin/member/viewer) reads the "admin" bucket; only partners read "partner".
 *
 *  Takes a bare role STRING, for the call sites that hold a `users` ROW and no scope (the
 *  task-reminder sweep resolves its recipient from the database, not from a session). A caller
 *  that already has a ScopeContext should use `streamOf(scope)` in lib/scope — the same
 *  decision, made from the app-wide definition of the PRN-13 stream, so the two can't drift. */
export function streamPrefRole(role: string): NotifRole {
  return role === "partner" ? "partner" : "admin";
}
export interface NotifChannel {
  email: boolean;
  inApp: boolean;
}

// The event catalog (drives the settings UI + resolution).
export const NOTIFICATION_EVENTS = [
  { role: "admin", key: "run_summary", label: "Run summary after each upload" },
  { role: "admin", key: "hot_leads", label: "A hot lead is found in an upload" },
  { role: "admin", key: "status_change", label: "A partner updates a lead's status" },
  { role: "admin", key: "task_due", label: "A task is due or overdue" },
  { role: "partner", key: "hot_leads", label: "A hot lead is routed to you" },
  { role: "partner", key: "new_leads", label: "New leads distributed to you" },
  { role: "partner", key: "assigned_lead", label: "A lead is assigned to you" },
  { role: "partner", key: "task_due", label: "A task is due or overdue" },
] as const;

export type NotifEvent = (typeof NOTIFICATION_EVENTS)[number]["key"];

export interface NotificationPrefs {
  admin: { run_summary: NotifChannel; hot_leads: NotifChannel; status_change: NotifChannel; task_due: NotifChannel };
  partner: { hot_leads: NotifChannel; new_leads: NotifChannel; assigned_lead: NotifChannel; task_due: NotifChannel };
}

// SET-03: "Digests on; alerts off" — digests email on; the status-change alert email
// off by default (still shown in-app so the notification center stays useful). Hot-lead
// alerts default fully on (email + in-app) for both roles: they're the highest-signal event.
// TSK-08: the due-task nudge fires exactly once per task, ever — a one-shot signal about
// the recipient's own committed work, so it defaults fully on for both roles too.
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  admin: {
    run_summary: { email: true, inApp: true },
    hot_leads: { email: true, inApp: true },
    status_change: { email: false, inApp: true },
    task_due: { email: true, inApp: true },
  },
  partner: {
    hot_leads: { email: true, inApp: true },
    new_leads: { email: true, inApp: true },
    // NTF-08 (WP-NF1 D4): a single admin re-route is a low-volume, per-USER signal, so it
    // shows in the bell but does NOT email by default — which is exactly what this path did
    // before it had its own entry (it rode `new_leads`'s in-app channel and never emailed).
    // The default is deliberately unchanged behavior; whether to email is an owner decision.
    assigned_lead: { email: false, inApp: true },
    task_due: { email: true, inApp: true },
  },
};

const ChannelSchema = z.object({ email: z.boolean(), inApp: z.boolean() }).partial();
export const NotificationPrefsSchema = z
  .object({
    admin: z
      .object({ run_summary: ChannelSchema, hot_leads: ChannelSchema, status_change: ChannelSchema, task_due: ChannelSchema })
      .partial(),
    partner: z
      .object({ hot_leads: ChannelSchema, new_leads: ChannelSchema, assigned_lead: ChannelSchema, task_due: ChannelSchema })
      .partial(),
  })
  .partial();
export type NotificationPrefsInput = z.infer<typeof NotificationPrefsSchema>;

/** The channel for a role+event, always falling back to the default. */
export function resolvePref(prefs: NotificationPrefs, role: NotifRole, event: NotifEvent): NotifChannel {
  const roleMap = prefs[role] as Record<string, NotifChannel> | undefined;
  const fallback = (DEFAULT_NOTIFICATION_PREFS[role] as Record<string, NotifChannel>)[event];
  return roleMap?.[event] ?? fallback;
}

/** Deep-merge a stored (possibly partial) value over the defaults. Pure. */
export function mergeNotificationPrefs(stored: NotificationPrefsInput | null | undefined): NotificationPrefs {
  const d = DEFAULT_NOTIFICATION_PREFS;
  const s = stored ?? {};
  const ch = (base: NotifChannel, over?: Partial<NotifChannel>): NotifChannel => ({
    email: over?.email ?? base.email,
    inApp: over?.inApp ?? base.inApp,
  });
  return {
    admin: {
      run_summary: ch(d.admin.run_summary, s.admin?.run_summary),
      hot_leads: ch(d.admin.hot_leads, s.admin?.hot_leads),
      status_change: ch(d.admin.status_change, s.admin?.status_change),
      task_due: ch(d.admin.task_due, s.admin?.task_due),
    },
    partner: {
      hot_leads: ch(d.partner.hot_leads, s.partner?.hot_leads),
      new_leads: ch(d.partner.new_leads, s.partner?.new_leads),
      assigned_lead: ch(d.partner.assigned_lead, s.partner?.assigned_lead),
      task_due: ch(d.partner.task_due, s.partner?.task_due),
    },
  };
}

/** Load the tenant's notification prefs, merged over defaults (PRN-11). */
export async function loadNotificationPrefs(db: DB, scope: ScopeContext): Promise<NotificationPrefs> {
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(tenantWhere(schema.settings, scope), eq(schema.settings.key, NOTIFICATION_PREFS_KEY)));
  const parsed = NotificationPrefsSchema.safeParse(row?.value ?? null);
  return mergeNotificationPrefs(parsed.success ? parsed.data : null);
}

/** Upsert the tenant's notification prefs (DM: one row per tenant+key). */
export async function saveNotificationPrefs(
  db: DB,
  scope: ScopeContext,
  input: NotificationPrefsInput,
): Promise<NotificationPrefs> {
  const merged = mergeNotificationPrefs(input);
  await db
    .insert(schema.settings)
    .values({ tenantId: scope.tenantId, key: NOTIFICATION_PREFS_KEY, value: merged })
    .onConflictDoUpdate({
      target: [schema.settings.tenantId, schema.settings.key],
      set: { value: merged, updatedAt: sql`now()` },
    });
  return merged;
}
