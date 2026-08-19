import { describe, it, expect, vi } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_EVENTS,
  mergeNotificationPrefs,
  type NotificationPrefs,
} from "@/modules/notify/prefs";
import {
  NOTIFICATION_EVENT_KEYS,
  PrefOverrideValueSchema,
  describeSubjectPrefs,
  parseOverrideValue,
  resolveEffectiveChannel,
  resolveOrgEmail,
  type PrefOverrideValue,
} from "@/modules/notify/pref-overrides";
import {
  DUMMY_SECRET,
  UNSUBSCRIBE_PATH,
  applyUnsubscribe,
  applyUnsubscribeToValue,
  buildUnsubscribeLinks,
  unsubscribeEventLabel,
} from "@/modules/notify/unsubscribe";
import { renderEmailDocument } from "@/modules/notify/email-template";
import {
  buildPartnerDigest,
  buildAdminRunSummary,
  buildPartnerHotAlert,
  buildAdminHotAlert,
  buildTaskDueReminder,
} from "@/modules/notify/digests";
import { buildLockoutEmail } from "@/lib/auth/notify";
import { timingSafeEqualStr } from "@/lib/auth/constant-time";
import type { RunSummary } from "@/modules/analytics/run-summary";

// The AUT-09 wiring assertion below needs to observe the comparison itself, so the shared
// constant-time helper is wrapped in a spy that still calls through to the real implementation.
vi.mock("@/lib/auth/constant-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/constant-time")>();
  return { ...actual, timingSafeEqualStr: vi.fn(actual.timingSafeEqualStr) };
});

const D = DEFAULT_NOTIFICATION_PREFS;
const LINKS = { typeUrl: "https://app.test/unsubscribe?token=a.b&event=hot_leads", typeLabel: "A hot lead is found in an upload", allUrl: "https://app.test/unsubscribe?token=a.b&event=all" };

describe("WP-NF2 NTF-10: per-subject preference overlay (pure resolution)", () => {
  it("NTF-10: no overlay resolves exactly to the tenant preference, for both roles", () => {
    for (const e of NOTIFICATION_EVENTS) {
      expect(resolveEffectiveChannel(D, null, e.role, e.key)).toEqual(
        (D[e.role] as Record<string, { email: boolean; inApp: boolean }>)[e.key],
      );
      // undefined and {} are the other two "never touched" shapes a loader can hand over.
      expect(resolveEffectiveChannel(D, undefined, e.role, e.key)).toEqual(resolveEffectiveChannel(D, null, e.role, e.key));
      expect(resolveEffectiveChannel(D, {}, e.role, e.key)).toEqual(resolveEffectiveChannel(D, null, e.role, e.key));
    }
  });

  it("NTF-10: the overlay applies FIELD-WISE — an untouched leg still tracks the tenant default", () => {
    // Tenant flips the in-app leg of an event the subject has only ever pinned on email.
    const tenant: NotificationPrefs = mergeNotificationPrefs({ admin: { hot_leads: { email: true, inApp: false } } });
    const overlay: PrefOverrideValue = { events: { hot_leads: { email: false } } };
    expect(resolveEffectiveChannel(tenant, overlay, "admin", "hot_leads")).toEqual({ email: false, inApp: false });

    const tenant2: NotificationPrefs = mergeNotificationPrefs({ admin: { hot_leads: { email: true, inApp: true } } });
    expect(resolveEffectiveChannel(tenant2, overlay, "admin", "hot_leads")).toEqual({ email: false, inApp: true });
  });

  it("NTF-10: an overlay can WIDEN a leg the tenant default has off", () => {
    // status_change defaults { email: false, inApp: true } — opting in is the whole point of NTF-15.
    expect(resolveEffectiveChannel(D, null, "admin", "status_change").email).toBe(false);
    expect(resolveEffectiveChannel(D, { events: { status_change: { email: true } } }, "admin", "status_change")).toEqual({
      email: true,
      inApp: true,
    });
  });

  it("NTF-10: allEmailsOff kills every email leg and NEVER touches in-app", () => {
    for (const e of NOTIFICATION_EVENTS) {
      const r = resolveEffectiveChannel(D, { allEmailsOff: true }, e.role, e.key);
      expect(r.email, `${e.role}/${e.key} email`).toBe(false);
      expect(r.inApp, `${e.role}/${e.key} inApp`).toBe(
        (D[e.role] as Record<string, { email: boolean; inApp: boolean }>)[e.key].inApp,
      );
    }
  });

  it("NTF-10: allEmailsOff beats a per-event email opt-in (applied last)", () => {
    const overlay: PrefOverrideValue = { events: { status_change: { email: true } }, allEmailsOff: true };
    expect(resolveEffectiveChannel(D, overlay, "admin", "status_change")).toEqual({ email: false, inApp: true });
  });

  it("NTF-10: allEmailsOff:false is inert — it never turns an off leg back on", () => {
    expect(resolveEffectiveChannel(D, { allEmailsOff: false }, "admin", "status_change").email).toBe(false);
    expect(resolveEffectiveChannel(D, { allEmailsOff: false }, "admin", "run_summary").email).toBe(true);
  });

  it("NTF-10: a partner-ORG overlay answers the EMAIL leg only", () => {
    expect(resolveOrgEmail(D, null, "new_leads")).toBe(true);
    expect(resolveOrgEmail(D, { events: { new_leads: { email: false } } }, "new_leads")).toBe(false);
    expect(resolveOrgEmail(D, { allEmailsOff: true }, "new_leads")).toBe(false);
    // An org row's in-app leg is meaningless and must not leak into the email answer.
    expect(resolveOrgEmail(D, { events: { new_leads: { inApp: false } } }, "new_leads")).toBe(true);
  });

  it("NTF-10: the same event key resolves per ROLE bucket", () => {
    const tenant = mergeNotificationPrefs({ admin: { task_due: { email: false } }, partner: { task_due: { email: true } } });
    const overlay: PrefOverrideValue = {};
    expect(resolveEffectiveChannel(tenant, overlay, "admin", "task_due").email).toBe(false);
    expect(resolveEffectiveChannel(tenant, overlay, "partner", "task_due").email).toBe(true);
  });
});

describe("WP-NF2 NTF-10: overlay value schema", () => {
  it("NTF-10: the overlay schema covers exactly the event catalog (drift guard)", () => {
    const everyKey = Object.fromEntries(NOTIFICATION_EVENT_KEYS.map((k) => [k, { email: false, inApp: false }]));
    expect(PrefOverrideValueSchema.safeParse({ events: everyKey }).success).toBe(true);
    // And the catalog itself contains no key the schema would reject.
    expect([...NOTIFICATION_EVENT_KEYS].sort()).toEqual([...new Set(NOTIFICATION_EVENTS.map((e) => e.key))].sort());
  });

  it("NTF-10: unknown event keys and unknown top-level keys are rejected", () => {
    expect(PrefOverrideValueSchema.safeParse({ events: { not_an_event: { email: false } } }).success).toBe(false);
    expect(PrefOverrideValueSchema.safeParse({ nope: true }).success).toBe(false);
    expect(PrefOverrideValueSchema.safeParse({ events: { hot_leads: { loud: true } } }).success).toBe(false);
    expect(PrefOverrideValueSchema.safeParse({ allEmailsOff: "yes" }).success).toBe(false);
  });

  it("NTF-10: a corrupt stored value resolves to NO overlay rather than dropping notifications", () => {
    expect(parseOverrideValue({ events: { bogus: 1 } })).toBeNull();
    expect(parseOverrideValue(null)).toEqual({});
    expect(parseOverrideValue({ allEmailsOff: true })).toEqual({ allEmailsOff: true });
  });
});

describe("WP-NF2 NTF-15: self-serve preferences view (pure)", () => {
  it("NTF-15: the view lists ONLY the caller's role bucket", () => {
    const admin = describeSubjectPrefs(D, null, "admin");
    const partner = describeSubjectPrefs(D, null, "partner");
    expect(admin.events.map((e) => e.key)).toEqual(NOTIFICATION_EVENTS.filter((e) => e.role === "admin").map((e) => e.key));
    expect(partner.events.map((e) => e.key)).toEqual(NOTIFICATION_EVENTS.filter((e) => e.role === "partner").map((e) => e.key));
    expect(admin.events.map((e) => e.key)).not.toContain("new_leads");
  });

  it("NTF-15: `overridden` marks the pinned legs, and `effective` reflects the overlay", () => {
    const view = describeSubjectPrefs(D, { events: { status_change: { email: true } }, allEmailsOff: false }, "admin");
    const row = view.events.find((e) => e.key === "status_change")!;
    expect(row.overridden).toEqual({ email: true, inApp: false });
    expect(row.effective).toEqual({ email: true, inApp: true });
    const untouched = view.events.find((e) => e.key === "run_summary")!;
    expect(untouched.overridden).toEqual({ email: false, inApp: false });
    expect(view.allEmailsOff).toBe(false);
  });

  it("NTF-15: allEmailsOff shows through both the flag and every effective email leg", () => {
    const view = describeSubjectPrefs(D, { allEmailsOff: true }, "partner");
    expect(view.allEmailsOff).toBe(true);
    expect(view.events.every((e) => e.effective.email === false)).toBe(true);
    expect(view.events.some((e) => e.effective.inApp === true)).toBe(true);
  });
});

describe("WP-NF2 NTF-13: unsubscribe application (pure)", () => {
  it("NTF-13: event=all sets allEmailsOff and is idempotent", () => {
    const once = applyUnsubscribeToValue({}, "all");
    expect(once).toEqual({ allEmailsOff: true });
    // Re-applying returns the SAME object, which is the signal the caller uses to skip the write.
    expect(applyUnsubscribeToValue(once!, "all")).toBe(once);
  });

  it("NTF-13: a typed event switches off only that event's EMAIL leg", () => {
    const v = applyUnsubscribeToValue({ events: { hot_leads: { email: true, inApp: true } } }, "hot_leads")!;
    expect(v.events!.hot_leads).toEqual({ email: false, inApp: true });
    expect(v.allEmailsOff).toBeUndefined();
    // Idempotent second click.
    expect(applyUnsubscribeToValue(v, "hot_leads")).toBe(v);
  });

  it("NTF-13: unsubscribing one event leaves every other event untouched", () => {
    const v = applyUnsubscribeToValue({ events: { run_summary: { email: true } } }, "hot_leads")!;
    expect(v.events!.run_summary).toEqual({ email: true });
    expect(v.events!.hot_leads).toEqual({ email: false });
  });

  it("NTF-13: an unknown-but-well-formed event key writes NOTHING", () => {
    expect(applyUnsubscribeToValue({}, "not_an_event")).toBeNull();
    expect(applyUnsubscribeToValue({}, "")).toBeNull();
    expect(applyUnsubscribeToValue({}, "__proto__")).toBeNull();
  });

  it("NTF-13: in-app legs survive every unsubscribe path", () => {
    const start: PrefOverrideValue = { events: { task_due: { email: true, inApp: true } } };
    expect(applyUnsubscribeToValue(start, "task_due")!.events!.task_due!.inApp).toBe(true);
    expect(applyUnsubscribeToValue(start, "all")!.events!.task_due!.inApp).toBe(true);
  });
});

describe("WP-NF2 NTF-13: token verification wiring (AUT-05/AUT-09)", () => {
  /** A db stub whose SELECT always returns no row — the "token does not exist" branch. */
  const emptyDb = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
  } as unknown as PostgresJsDatabase<typeof schema>;

  it("NTF-13: a token matching no row STILL runs an equal-length constant-time compare", async () => {
    vi.mocked(timingSafeEqualStr).mockClear();
    await applyUnsubscribe(emptyDb, { token: `abc.${"z".repeat(43)}`, event: "all" });
    expect(timingSafeEqualStr).toHaveBeenCalledTimes(1);
    const [submitted, against] = vi.mocked(timingSafeEqualStr).mock.calls[0];
    expect(against).toBe(DUMMY_SECRET);
    expect(submitted.length).toBe(against.length); // the whole point of the dummy
  });

  it("NTF-13: the dummy is the same length a real 32-byte base64url secret encodes to", () => {
    expect(DUMMY_SECRET).toHaveLength(Buffer.from(new Uint8Array(32)).toString("base64url").length);
  });

  it("NTF-13: a malformed token (no separator) never reaches a lookup and never throws", async () => {
    vi.mocked(timingSafeEqualStr).mockClear();
    const thrower = {
      select: () => {
        throw new Error("a malformed token must not be looked up");
      },
    } as unknown as PostgresJsDatabase<typeof schema>;
    await expect(applyUnsubscribe(thrower, { token: "no-separator-here", event: "all" })).resolves.toBeUndefined();
    await expect(applyUnsubscribe(thrower, { token: ".leading-dot", event: "all" })).resolves.toBeUndefined();
    expect(timingSafeEqualStr).toHaveBeenCalledTimes(2); // still compared, still uniform
  });
});

describe("WP-NF2 NTF-14: unsubscribe links", () => {
  it("NTF-14: links carry the token and the event, URL-encoded, on the public path", () => {
    const links = buildUnsubscribeLinks({ baseUrl: "https://app.test", token: "id.se+cret/", role: "admin", event: "hot_leads" });
    expect(links.typeUrl).toBe(`https://app.test${UNSUBSCRIBE_PATH}?token=id.se%2Bcret%2F&event=hot_leads`);
    expect(links.allUrl).toBe(`https://app.test${UNSUBSCRIBE_PATH}?token=id.se%2Bcret%2F&event=all`);
    expect(links.typeLabel).toBe(unsubscribeEventLabel("admin", "hot_leads"));
  });

  it("NTF-14: the label is the catalog label for the RECIPIENT'S role bucket", () => {
    expect(unsubscribeEventLabel("admin", "hot_leads")).toBe("A hot lead is found in an upload");
    expect(unsubscribeEventLabel("partner", "hot_leads")).toBe("A hot lead is routed to you");
  });
});

describe("WP-NF2 NTF-14: email footer", () => {
  const doc = (unsubscribe?: typeof LINKS) =>
    renderEmailDocument({ title: "T", preheader: "P", contentHtml: "<p>x</p>", unsubscribe });

  // The `&` between the query params is `&amp;` in the rendered document — every attribute goes
  // through escapeHtml, which is what keeps a hostile label or URL out of the markup.
  const escapedUrl = (u: string) => u.replace(/&/g, "&amp;");

  it("NTF-14: the footer renders both links when they are supplied", () => {
    const html = doc(LINKS);
    expect(html).toContain(`href="${escapedUrl(LINKS.typeUrl)}"`);
    expect(html).toContain(`Unsubscribe from ${LINKS.typeLabel}`);
    expect(html).toContain(`href="${escapedUrl(LINKS.allUrl)}"`);
    expect(html).toContain("Stop all notification emails");
  });

  it("NTF-14: no links, no footer additions — the shell is unchanged", () => {
    expect(doc()).not.toContain("Unsubscribe");
    expect(doc()).not.toContain("Stop all notification emails");
  });

  it("NTF-14: the label is escaped and a non-http scheme collapses to #", () => {
    const html = doc({ typeUrl: "javascript:alert(1)", typeLabel: '<img src=x onerror="1">', allUrl: "https://app.test/u" });
    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  const summary: RunSummary = { total: 1, kept: 1, removed: 0, unmatched: 0, perPartner: [] };
  const lead = { refId: "LD-26-00001", city: "Austin", state: "TX" };

  it("NTF-14: EVERY notification-email builder threads the footer links through", () => {
    const built = [
      buildPartnerDigest({ appName: "A", partnerName: "P", partnerRef: "PR-001", portalUrl: "https://app.test/portal", uploadRef: "IM-1", leads: [lead], partnerColor: "#f4c95d", unsubscribe: LINKS }),
      buildAdminRunSummary({ appName: "A", uploadRef: "IM-1", summary, unsubscribe: LINKS }),
      buildPartnerHotAlert({ appName: "A", partnerName: "P", partnerRef: "PR-001", partnerColor: "#f4c95d", portalUrl: "https://app.test/portal/leads", leads: [{ ...lead, score: 40 }], unsubscribe: LINKS }),
      buildAdminHotAlert({ appName: "A", uploadRef: "IM-1", leads: [{ ...lead, score: 40 }], unsubscribe: LINKS }),
      buildTaskDueReminder({ appName: "A", taskTitle: "Call", dueOn: "2026-08-19", overdue: false, leadRef: lead.refId, city: lead.city, state: lead.state, leadUrl: "https://app.test/leads", unsubscribe: LINKS }),
    ];
    for (const c of built) {
      expect(c.html).toContain(escapedUrl(LINKS.allUrl));
      expect(c.html).toContain("Stop all notification emails");
    }
  });

  it("NTF-14: transactional AUTH email carries NO unsubscribe (NTF-05 clause)", () => {
    const html = buildLockoutEmail("someone@example.test").html ?? "";
    expect(html).not.toContain("Unsubscribe");
    expect(html).not.toContain("/unsubscribe");
  });
});
