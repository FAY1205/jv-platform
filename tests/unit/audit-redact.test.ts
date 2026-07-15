import { describe, expect, it } from "vitest";
import {
  AUDIT_PII_LEAD_FIELDS,
  REDACTED,
  maskAuditValue,
  isAuditPiiLeadField,
} from "@/modules/audit/redact";

// The audit trail (audit_log) is append-only compliance evidence (DM-04). It must
// record that a consumer-PII field changed — never the value (SEC-05) — so no seller
// PII is ever trapped in a place the retention sweep can't reach (LGL-02). This helper
// is the single source of truth for that redaction; it is PURE (no I/O).

describe("SEC-05: maskAuditValue never leaks a consumer-PII value", () => {
  it("SEC-05: a present value becomes the sentinel, not the value", () => {
    expect(maskAuditValue("Jane")).toBe(REDACTED);
    expect(maskAuditValue("jane.doe@gmail.com")).toBe(REDACTED);
    expect(maskAuditValue("(856) 555-0100")).toBe(REDACTED);
    expect(maskAuditValue("Relocating for work")).toBe(REDACTED);
  });

  it("SEC-05: the sentinel carries none of the input's characters (no partial leak)", () => {
    const masked = maskAuditValue("jane.doe@gmail.com");
    expect(masked).toBe(REDACTED);
    expect(masked).not.toContain("jane");
    expect(masked).not.toContain("@");
  });

  it("SEC-05: empty/absent stays null so added-vs-cleared remains legible", () => {
    expect(maskAuditValue(null)).toBeNull();
    expect(maskAuditValue(undefined)).toBeNull();
    expect(maskAuditValue("")).toBeNull();
  });
});

describe("SEC-05 / DM-04: audit PII field classification", () => {
  it("SEC-05: the eight seller identity/contact/context fields are PII", () => {
    for (const f of [
      "sellerFirst",
      "sellerLast",
      "phone",
      "email",
      "reasonForSelling",
      "motivation",
      "timeToSell",
      "notes",
    ]) {
      expect(isAuditPiiLeadField(f), `${f} must be PII`).toBe(true);
      expect(AUDIT_PII_LEAD_FIELDS.has(f), `${f} must be in the set`).toBe(true);
    }
  });

  it("DM-04: property/routing fields are NOT masked — their old→new drives audit value", () => {
    for (const f of ["address", "city", "state", "zip", "campaign"]) {
      expect(isAuditPiiLeadField(f), `${f} must stay raw`).toBe(false);
    }
  });

  it("an unknown field name is treated as non-PII (explicit allow-list, not guesswork)", () => {
    expect(isAuditPiiLeadField("partnerId")).toBe(false);
    expect(isAuditPiiLeadField("")).toBe(false);
  });
});
