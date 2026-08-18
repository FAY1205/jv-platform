import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS,
  resolvePref,
  mergeNotificationPrefs,
  NotificationPrefsSchema,
  NOTIFICATION_EVENTS,
} from "@/modules/notify/prefs";

// NTF-05 / SET-03: per-role, per-event email vs in-app preferences. Default is
// "digests on; alerts off" (email-wise) — resolved against sensible defaults so a
// missing/partial stored value never breaks notification delivery.
describe("notification prefs", () => {
  it("SET-03: digests default on, the status-change alert email defaults off", () => {
    expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, "admin", "run_summary").email).toBe(true);
    expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, "partner", "new_leads").email).toBe(true);
    expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, "admin", "status_change").email).toBe(false);
    // the in-app center still surfaces status changes even when the email is off.
    expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, "admin", "status_change").inApp).toBe(true);
  });

  it("NTF-05: a partial stored value falls back to defaults for missing entries", () => {
    const merged = mergeNotificationPrefs({ admin: { run_summary: { email: false, inApp: true } } });
    expect(resolvePref(merged, "admin", "run_summary").email).toBe(false); // overridden
    expect(resolvePref(merged, "partner", "new_leads").email).toBe(true); // still default
  });

  it("NTF-05: schema rejects a non-boolean channel value", () => {
    expect(NotificationPrefsSchema.safeParse({ admin: { run_summary: { email: "yes" } } }).success).toBe(false);
    expect(NotificationPrefsSchema.safeParse({ partner: { new_leads: { email: false, inApp: false } } }).success).toBe(true);
  });

  it("exposes the event catalog for the settings UI", () => {
    const keys = NOTIFICATION_EVENTS.map((e) => `${e.role}.${e.key}`);
    expect(keys).toContain("admin.run_summary");
    expect(keys).toContain("partner.new_leads");
  });

  it("TSK-08: the task_due event exists for both roles and defaults fully on", () => {
    expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, "admin", "task_due")).toEqual({ email: true, inApp: true });
    expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, "partner", "task_due")).toEqual({ email: true, inApp: true });
    // The settings UI renders straight off the catalog, so presence here IS the UI wiring.
    const keys = NOTIFICATION_EVENTS.map((e) => `${e.role}.${e.key}`);
    expect(keys).toContain("admin.task_due");
    expect(keys).toContain("partner.task_due");
  });

  it("TSK-08: a stored value that predates task_due still resolves it (never drops a nudge)", () => {
    // The realistic case: a tenant saved prefs before this event existed, so their row has
    // no task_due key at all. Resolution must fall back to the default, not to "off".
    const merged = mergeNotificationPrefs({ admin: { status_change: { email: true } }, partner: { new_leads: { email: false } } });
    expect(resolvePref(merged, "admin", "task_due")).toEqual({ email: true, inApp: true });
    expect(resolvePref(merged, "partner", "task_due")).toEqual({ email: true, inApp: true });
    // …and a partial task_due value keeps the untouched channel at its default.
    expect(resolvePref(mergeNotificationPrefs({ partner: { task_due: { email: false } } }), "partner", "task_due")).toEqual({
      email: false,
      inApp: true,
    });
  });

  it("NTF-08: partner assigned_lead is its own event — in-app on, email off by default", () => {
    // WP-NF1 D4: the admin re-route notification used to ride `new_leads`, so the Settings row
    // a partner admin toggled ("New leads distributed to you") governed two different things
    // and the email checkbox on it was a lie for one of them. Its own entry, defaulting to
    // today's exact behavior: shown in the bell, never emailed.
    expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, "partner", "assigned_lead")).toEqual({ email: false, inApp: true });
    // The settings UI renders straight off the catalog, so presence here IS the UI wiring.
    expect(NOTIFICATION_EVENTS.map((e) => `${e.role}.${e.key}`)).toContain("partner.assigned_lead");
    expect(NOTIFICATION_EVENTS.find((e) => e.role === "partner" && e.key === "assigned_lead")?.label).toBe(
      "A lead is assigned to you",
    );
  });

  it("NTF-08: a stored value that predates assigned_lead still resolves it (forward-compatible)", () => {
    // Every tenant that has ever saved prefs has a row without this key.
    const merged = mergeNotificationPrefs({ partner: { new_leads: { email: false, inApp: false } } });
    expect(resolvePref(merged, "partner", "assigned_lead")).toEqual({ email: false, inApp: true });
    // …and a partial value keeps the untouched channel at its default.
    expect(resolvePref(mergeNotificationPrefs({ partner: { assigned_lead: { email: true } } }), "partner", "assigned_lead")).toEqual({
      email: true,
      inApp: true,
    });
    expect(NotificationPrefsSchema.safeParse({ partner: { assigned_lead: { email: true, inApp: false } } }).success).toBe(true);
    expect(NotificationPrefsSchema.safeParse({ partner: { assigned_lead: { inApp: "yes" } } }).success).toBe(false);
  });

  it("NTF-05: the no-prefs fallback is symmetric — every run-digest event defaults BOTH channels on", () => {
    // WP-NF1 D8: enqueueRunDigests used to hardcode email=true / inApp=false when a caller
    // omitted prefs; it now resolves both against these defaults. This pins what that fallback
    // means for the events that path serves — email behavior identical, in-app no longer
    // silently off. (The DB-level proof is in tests/integration/outbox.test.ts.)
    for (const [role, ev] of [
      ["partner", "new_leads"],
      ["partner", "hot_leads"],
      ["admin", "run_summary"],
      ["admin", "hot_leads"],
    ] as const) {
      expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, role, ev)).toEqual({ email: true, inApp: true });
    }
  });

  it("SCR-12: hot-lead alerts default fully on (email + in-app) for both roles", () => {
    expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, "admin", "hot_leads")).toEqual({ email: true, inApp: true });
    expect(resolvePref(DEFAULT_NOTIFICATION_PREFS, "partner", "hot_leads")).toEqual({ email: true, inApp: true });
    const keys = NOTIFICATION_EVENTS.map((e) => `${e.role}.${e.key}`);
    expect(keys).toContain("admin.hot_leads");
    expect(keys).toContain("partner.hot_leads");
  });
});
