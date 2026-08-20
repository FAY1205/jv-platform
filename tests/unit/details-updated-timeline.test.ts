import { describe, expect, it } from "vitest";
import { detailsUpdatedLabel, LEAD_FIELD_DISPLAY_NAMES } from "@/modules/leads/timeline";
import { EDITABLE_COLUMNS } from "@/modules/leads/commands";

// N5-14 — the "Details updated" timeline entry is derived from `lead.edited` audit rows.
// The rule that matters most is negative: field NAMES reach the screen, values never do.

/** A `lead.edited` audit row's `after`, exactly as commands.ts writes it: PII fields masked
 *  to a presence sentinel (ADR-0031), routing/property fields raw, and a partner move folded
 *  into the SAME row as `effectiveOwner` + `partner`. */
const AFTER_FIELDS_ONLY = { phone: "present", email: "present" };
const AFTER_PARTNER_ONLY = { effectiveOwner: "p2", partner: { from: "p1", to: "p2", partnerRefId: "JV-002" } };
const AFTER_MIXED = { ...AFTER_FIELDS_ONLY, ...AFTER_PARTNER_ONLY };

describe("N5-14: detailsUpdatedLabel — names only, never values", () => {
  it("N5-14: a field edit becomes 'Details updated: <names>' in the roster's order", () => {
    expect(detailsUpdatedLabel(AFTER_FIELDS_ONLY)).toBe("Details updated: phone, email");
  });

  it("N5-14/SEC-05: no audited VALUE ever reaches the label — masked or raw", () => {
    const label = detailsUpdatedLabel({
      phone: "present",
      address: "419 Cottonwood Ln",
      campaign: "PPC — Sell Fast",
      notes: "Tenant in place through October.",
    });
    expect(label).toBe("Details updated: phone, address, source, source notes");
    for (const value of ["present", "419 Cottonwood Ln", "PPC — Sell Fast", "Tenant in place through October."]) {
      expect(label).not.toContain(value);
    }
  });

  it("N5-14: a PARTNER-only row produces no entry — the `assigned` entry already tells that story", () => {
    expect(detailsUpdatedLabel(AFTER_PARTNER_ONLY)).toBeNull();
  });

  it("N5-14: a row with BOTH a field edit and a partner move lists only the field names", () => {
    const label = detailsUpdatedLabel(AFTER_MIXED);
    expect(label).toBe("Details updated: phone, email");
    expect(label).not.toMatch(/owner|partner|JV-002|p2/i);
  });

  it("N5-14: an unrecognised key can never reach the screen (the display map is an allowlist)", () => {
    expect(detailsUpdatedLabel({ dedupeKey: "x", addressNormalized: "y" })).toBeNull();
    expect(detailsUpdatedLabel({ phone: "present", somethingNew: "z" })).toBe("Details updated: phone");
  });

  it("N5-14: a malformed or empty payload produces no entry rather than a broken label", () => {
    for (const bad of [null, undefined, {}, [], "phone", 7]) {
      expect(detailsUpdatedLabel(bad)).toBeNull();
    }
  });

  it("N5-14: the order is the roster's, not the payload's — the label is stable", () => {
    expect(detailsUpdatedLabel({ email: "present", phone: "present" })).toBe("Details updated: phone, email");
    expect(detailsUpdatedLabel({ zip: "1", city: "2" })).toBe("Details updated: city, ZIP");
  });
});

describe("N5-14: the display map stays in lockstep with what the audit trail can hold", () => {
  it("N5-14: every editable column has a display name, and the map invents none", () => {
    // EDITABLE_COLUMNS is the only set of keys `lead.edited` can carry as field changes
    // (commands.ts builds before/after from exactly it), so the two must match exactly —
    // a column added there without a name here would silently vanish from the timeline.
    expect(Object.keys(LEAD_FIELD_DISPLAY_NAMES).sort()).toEqual([...EDITABLE_COLUMNS].sort());
  });
});
