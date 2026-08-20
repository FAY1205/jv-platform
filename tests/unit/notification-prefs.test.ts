import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFS, resolvePref, NOTIFICATION_EVENTS } from "@/modules/notify/prefs";
import { PrefOverrideValueSchema, NOTIFICATION_EVENT_KEYS } from "@/modules/notify/pref-overrides";

// NTF-05 / SET-03: per-role, per-event email vs in-app DEFAULTS.
//
// WP-NF2b (owner decision 2026-08-20): this module is now the defaults + the catalog and
// nothing else. The workspace `settings` row is retired — `mergeNotificationPrefs`,
// `NotificationPrefsSchema` and the load/save pair went with it — so the assertions that used
// to read "a stored tenant value falls back to defaults for missing entries" move to the layer
// that still has stored values: the per-subject overlay (tests/unit/notify-pref-overrides.ts
// owns the resolution matrix; the drift guard below now checks the OVERLAY schema, which is the
// remaining place a half-added event would fail to persist).
describe("notification prefs", () => {
  it("SET-03: digests default on, the status-change alert email defaults off", () => {
    expect(resolvePref("admin", "run_summary").email).toBe(true);
    expect(resolvePref("partner", "new_leads").email).toBe(true);
    expect(resolvePref("admin", "status_change").email).toBe(false);
    // the in-app center still surfaces status changes even when the email is off.
    expect(resolvePref("admin", "status_change").inApp).toBe(true);
  });

  it("NF2b: resolvePref reads the shipped defaults and nothing else", () => {
    // The whole base layer, in one assertion: there is no argument that can move it, because
    // there is no stored workspace matrix to pass. A per-seat change goes through the overlay.
    for (const { role, key } of NOTIFICATION_EVENTS) {
      expect(resolvePref(role, key)).toEqual((DEFAULT_NOTIFICATION_PREFS[role] as Record<string, unknown>)[key]);
    }
  });

  it("exposes the event catalog for the preferences UI", () => {
    const keys = NOTIFICATION_EVENTS.map((e) => `${e.role}.${e.key}`);
    expect(keys).toContain("admin.run_summary");
    expect(keys).toContain("partner.new_leads");
  });

  it("TSK-08: the task_due event exists for both roles and defaults fully on", () => {
    expect(resolvePref("admin", "task_due")).toEqual({ email: true, inApp: true });
    expect(resolvePref("partner", "task_due")).toEqual({ email: true, inApp: true });
    // The preferences UI renders straight off the catalog, so presence here IS the UI wiring.
    const keys = NOTIFICATION_EVENTS.map((e) => `${e.role}.${e.key}`);
    expect(keys).toContain("admin.task_due");
    expect(keys).toContain("partner.task_due");
  });

  it("NTF-08: partner assigned_lead is its own event — in-app on, email off by default", () => {
    // WP-NF1 D4: the admin re-route notification used to ride `new_leads`, so the one row a
    // reader toggled ("New leads distributed to you") governed two different things and the
    // email checkbox on it was a lie for one of them. Its own entry, defaulting to today's
    // exact behavior: shown in the bell, never emailed.
    expect(resolvePref("partner", "assigned_lead")).toEqual({ email: false, inApp: true });
    expect(NOTIFICATION_EVENTS.map((e) => `${e.role}.${e.key}`)).toContain("partner.assigned_lead");
    expect(NOTIFICATION_EVENTS.find((e) => e.role === "partner" && e.key === "assigned_lead")?.label).toBe(
      "A lead is assigned to you",
    );
  });

  it("NTF-05: every run-digest event defaults BOTH channels on", () => {
    // WP-NF1 D8: enqueueRunDigests used to hardcode email=true / inApp=false when a caller
    // omitted prefs; it resolves both against these defaults instead. WP-NF2b removed the
    // `prefs` parameter entirely, so THESE are what that path serves.
    // (The DB-level proof is in tests/integration/outbox.test.ts.)
    for (const [role, ev] of [
      ["partner", "new_leads"],
      ["partner", "hot_leads"],
      ["admin", "run_summary"],
      ["admin", "hot_leads"],
    ] as const) {
      expect(resolvePref(role, ev)).toEqual({ email: true, inApp: true });
    }
  });

  it("NTF-11: the four new WP-NF2 types are catalog rows in the right buckets", () => {
    const keys = NOTIFICATION_EVENTS.map((e) => `${e.role}.${e.key}`);
    // task_assigned is the only new type with BOTH buckets — a task can land with a staff seat
    // or a partner seat, and each stream reads its own row.
    expect(keys).toContain("admin.task_assigned");
    expect(keys).toContain("partner.task_assigned");
    // The other three are OPS events: admin bucket only (WP-NF2 §10.4).
    expect(keys).toContain("admin.partner_note");
    expect(keys).toContain("admin.import_result");
    expect(keys).toContain("admin.partner_activated");
    expect(keys).not.toContain("partner.partner_note");
    expect(keys).not.toContain("partner.import_result");
    expect(keys).not.toContain("partner.partner_activated");
  });

  it("NTF-11: every new type defaults email OFF, in-app ON (§10.1)", () => {
    // The assigned_lead precedent. Flipping any of these is an owner one-liner — this test is
    // what makes such a flip a deliberate, reviewed edit rather than a silent drift. Post-NF2b
    // a flip moves every seat that has not pinned that leg, in every tenant.
    for (const key of ["task_assigned", "partner_note", "import_result", "partner_activated"] as const) {
      expect(resolvePref("admin", key)).toEqual({ email: false, inApp: true });
    }
    expect(resolvePref("partner", "task_assigned")).toEqual({ email: false, inApp: true });
  });

  it("NTF-11: catalog, defaults and the OVERLAY schema stay in sync (drift guard)", () => {
    // The three places a new event has to be declared, post-NF2b. A row present in one and
    // missing from another is the exact failure this guards: the preferences card renders off
    // the catalog, resolution reads the defaults, and the PUT validates against the overlay
    // schema — so a half-added event renders a checkbox that either can't be saved or resolves
    // to `undefined`. (The workspace schema this used to check no longer exists.)
    for (const { role, key } of NOTIFICATION_EVENTS) {
      const fromDefaults = (DEFAULT_NOTIFICATION_PREFS[role] as Record<string, unknown>)[key];
      expect(fromDefaults, `${role}.${key} missing from DEFAULT_NOTIFICATION_PREFS`).toBeDefined();
      expect(NOTIFICATION_EVENT_KEYS, `${key} missing from NOTIFICATION_EVENT_KEYS`).toContain(key);
      expect(
        PrefOverrideValueSchema.safeParse({ events: { [key]: { email: true, inApp: false } } }).success,
        `${role}.${key} rejected by PrefOverrideValueSchema`,
      ).toBe(true);
    }
  });

  it("SCR-12: hot-lead alerts default fully on (email + in-app) for both roles", () => {
    expect(resolvePref("admin", "hot_leads")).toEqual({ email: true, inApp: true });
    expect(resolvePref("partner", "hot_leads")).toEqual({ email: true, inApp: true });
    const keys = NOTIFICATION_EVENTS.map((e) => `${e.role}.${e.key}`);
    expect(keys).toContain("admin.hot_leads");
    expect(keys).toContain("partner.hot_leads");
  });
});
