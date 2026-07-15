import { describe, expect, it } from "vitest";
import { redactionPatch } from "@/modules/retention/purge";
import { EDITABLE_COLUMNS } from "@/modules/leads/commands";
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

  it("DM-04: COARSE location + campaign are NOT masked — their old→new drives audit value", () => {
    // `address` was in this list until the lockstep check below caught it: the retention
    // sweep nulls the street address as PII, so leaving it raw let it survive forever in
    // the append-only trail. Coarse location is not personally identifying and still
    // shows a routing change (assignment keys off zip5 + state).
    for (const f of ["city", "state", "zip", "campaign"]) {
      expect(isAuditPiiLeadField(f), `${f} must stay raw`).toBe(false);
    }
  });

  it("an unknown field name is treated as non-PII (explicit allow-list, not guesswork)", () => {
    expect(isAuditPiiLeadField("partnerId")).toBe(false);
    expect(isAuditPiiLeadField("")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0031's contract, enforced instead of merely stated: "a column that is
// purge-worthy on `leads` must be mask-worthy here, or PII re-enters the permanent
// trail." Nothing checked it, and it was already broken — `address` is editable
// (so it reaches audit before/after) and the retention sweep nulls it as PII, but it
// was not masked. Edit a lead's address, void it, purge it: the street address still
// sat in audit_log forever. This test is the lockstep the ADR asked for.
// ─────────────────────────────────────────────────────────────────────────────
describe("LGL-02/SEC-05: audit masking stays in lockstep with the retention sweep", () => {
  // DERIVED, not hand-copied. Both sides come from the real modules, so adding a
  // purge-worthy column to the sweep (or a new editable column) fails this test until
  // it is classified — the list can never silently drift out of lockstep again. A
  // hand-copied list is exactly what let `address` slip through in the first place.
  const purgeWorthy = Object.keys(redactionPatch());
  const editable = EDITABLE_COLUMNS as readonly string[];
  const mustBeMasked = purgeWorthy.filter((f) => editable.includes(f));

  it("LGL-02: the derivation actually finds columns (guards against a vacuous pass)", () => {
    // If a refactor renamed things, an empty list would make every case below trivially
    // pass and the lockstep would silently stop being checked.
    expect(mustBeMasked.length).toBeGreaterThanOrEqual(8);
    expect(mustBeMasked).toContain("address");
  });

  it.each(mustBeMasked)(
    "LGL-02: %s is purge-worthy on leads AND editable, so it must be masked in the trail",
    (field: string) => {
      expect(isAuditPiiLeadField(field)).toBe(true);
    },
  );

  it("DM-04: coarse location + campaign stay RAW — their old→new is the audit's point", () => {
    // The sweep deliberately KEEPS these on the lead (not personally identifying), so
    // they carry no PII into the trail and remain legible evidence of a routing change.
    for (const field of ["city", "state", "zip", "campaign"]) {
      expect(purgeWorthy).not.toContain(field);
      expect(isAuditPiiLeadField(field)).toBe(false);
    }
  });

  it("SEC-05: a street address is masked to the sentinel, never partially leaked", () => {
    expect(maskAuditValue("848 Caton Ave")).toBe(REDACTED);
    expect(maskAuditValue("848 Caton Ave")).not.toContain("Caton");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAIL-CLOSED. The intersection check above is necessary but not sufficient: it only
// fires when a column is in BOTH lists. The classifier is an ALLOW-LIST, so anything
// unlisted defaults to RAW — meaning a new editable PII column that someone forgets
// to add to the retention sweep too would reach the permanent trail in the clear with
// zero test failures. That is exactly how `address` slipped through. This makes the
// default deny: every editable column must be consciously classified as PII or
// explicitly named safe, so a new one cannot pass by being forgotten twice.
// ─────────────────────────────────────────────────────────────────────────────
describe("SEC-05: every editable column is consciously classified (allow-list, fail-closed)", () => {
  // Reviewed and named safe: not personally identifying, and their old→new is the
  // audit-relevant signal for a routing change (DM-04). Adding to this set is a
  // deliberate act a reviewer can see in the diff — which is the whole point.
  const KNOWN_SAFE_NON_PII = new Set(["city", "state", "zip", "campaign"]);

  it.each(EDITABLE_COLUMNS as readonly string[])(
    "SEC-05: %s is classified — masked as PII, or explicitly reviewed as non-PII",
    (field: string) => {
      const classified = isAuditPiiLeadField(field) || KNOWN_SAFE_NON_PII.has(field);
      expect(
        classified,
        `"${field}" is editable and therefore reaches audit_log's before/after, but it is ` +
          `neither in AUDIT_PII_LEAD_FIELDS nor in KNOWN_SAFE_NON_PII. Classify it: if it can ` +
          `carry consumer PII, add it to AUDIT_PII_LEAD_FIELDS (and to the retention sweep's ` +
          `redactionPatch); if it genuinely cannot, add it here with a reason. Leaving it ` +
          `unclassified writes it to the append-only trail in the clear, permanently.`,
      ).toBe(true);
    },
  );

  it("SEC-05: the two sets are disjoint — a column can't be both PII and 'safe'", () => {
    for (const field of KNOWN_SAFE_NON_PII) {
      expect(isAuditPiiLeadField(field)).toBe(false);
    }
  });
});
