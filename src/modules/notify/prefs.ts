// ─────────────────────────────────────────────────────────────────────────────
// Notification preferences (NTF-05 / SET-03). Per role, per event type: send email,
// show in-app, or both. Transactional auth email is separate and always on (never here).
//
// WP-NF2b (owner decision 2026-08-20) — THERE IS NO WORKSPACE LAYER. Resolution is
// exactly two layers:
//
//     code defaults (DEFAULT_NOTIFICATION_PREFS)  ⊕  the subject's own overlay
//
// The tenant `settings` row keyed `notification_prefs` used to sit between them. It is
// GONE from every read path: nothing in the codebase writes or reads that key any more,
// and no migration deletes it because prod never had one (verified 2026-08-20 — zero
// rows). A stored row, if one ever existed in some environment, is now simply inert data.
//
// So this file is the DEFAULTS source and the catalog, and nothing else: the per-subject
// layer lives in pref-overrides.ts, and a seat edits its own via /api/me/notification-prefs.
// Defaults stay deliberately one-line-flippable (see the comments on the constant below) —
// changing a default now moves every seat that has not pinned that leg, in every tenant.
// ─────────────────────────────────────────────────────────────────────────────

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
  // WP-NF2 NTF-11. `task_assigned` is the only new event with BOTH buckets — a task can be
  // handed to a staff seat or to a partner seat, and each stream reads its own row.
  { role: "admin", key: "task_assigned", label: "A task is assigned to you" },
  // The other three are OPS events: they describe the tenant's pipeline, not a lead someone
  // owns, so they exist only in the admin bucket (WP-NF2 §10.4 — admin-TIER recipients).
  { role: "admin", key: "partner_note", label: "A partner adds a note to a lead" },
  { role: "admin", key: "import_result", label: "An import completes or fails" },
  { role: "admin", key: "partner_activated", label: "A partner accepts their invite" },
  { role: "partner", key: "hot_leads", label: "A hot lead is routed to you" },
  { role: "partner", key: "new_leads", label: "New leads distributed to you" },
  { role: "partner", key: "assigned_lead", label: "A lead is assigned to you" },
  { role: "partner", key: "task_due", label: "A task is due or overdue" },
  { role: "partner", key: "task_assigned", label: "A task is assigned to you" },
] as const;

export type NotifEvent = (typeof NOTIFICATION_EVENTS)[number]["key"];

export interface NotificationPrefs {
  admin: {
    run_summary: NotifChannel;
    hot_leads: NotifChannel;
    status_change: NotifChannel;
    task_due: NotifChannel;
    task_assigned: NotifChannel;
    partner_note: NotifChannel;
    import_result: NotifChannel;
    partner_activated: NotifChannel;
  };
  partner: {
    hot_leads: NotifChannel;
    new_leads: NotifChannel;
    assigned_lead: NotifChannel;
    task_due: NotifChannel;
    task_assigned: NotifChannel;
  };
}

// ⚠️ WP-NF2b: these are now the ONLY base layer. Flipping a leg here moves every seat in every
// tenant that has not pinned that leg in its own overlay — which is exactly what the owner
// decision asked for ("one place decides the default; each person decides for themselves").
//
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
    // WP-NF2 NTF-11 (§10.1): all four new types default {email:false, inApp:true} — the
    // `assigned_lead` precedent. They are per-USER, event-driven signals whose volume scales
    // with how busy a tenant is, so the bell is the safe default surface and the email leg is
    // opt-in per seat (NTF-15). Flipping any of these to email-on is a one-line owner decision.
    task_assigned: { email: false, inApp: true },
    partner_note: { email: false, inApp: true },
    import_result: { email: false, inApp: true },
    partner_activated: { email: false, inApp: true },
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
    task_assigned: { email: false, inApp: true },
  },
};

/**
 * The DEFAULT channel for a role+event — the BASE layer of the two-layer resolution. PURE.
 *
 * WP-NF2b: this used to take a `NotificationPrefs` argument, because a tenant could store its
 * own matrix over the defaults. It cannot any more, so the parameter is gone rather than being
 * satisfied with `DEFAULT_NOTIFICATION_PREFS` at every call site — a constant threaded through
 * a signature reads like a variable and invites someone to thread a different one.
 *
 * Almost every caller wants `resolveEffectiveChannel` (pref-overrides.ts), which applies the
 * subject's overlay on top of this. The exception is an address with no subject at all — an
 * env-allowlist ops mailbox that is not a seat (WP-NF2 §10.3).
 */
export function resolvePref(role: NotifRole, event: NotifEvent): NotifChannel {
  return (DEFAULT_NOTIFICATION_PREFS[role] as Record<string, NotifChannel>)[event];
}
