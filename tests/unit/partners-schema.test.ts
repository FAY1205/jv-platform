import { describe, expect, it } from "vitest";
import { PartnerCreateSchema, PartnerUpdateSchema, DeactivateSchema } from "@/modules/partners/schema";

// ADM-03: contact-detail validation for the partner CRUD forms (API-04 Zod boundary).
describe("PartnerCreateSchema", () => {
  it("PARTNERS-VAL-01: requires a non-empty name and trims it", () => {
    expect(PartnerCreateSchema.safeParse({ name: "   ", email: "a@b.co" }).success).toBe(false);
    const ok = PartnerCreateSchema.parse({ name: "  Acme Capital  ", email: "a@b.co" });
    expect(ok.name).toBe("Acme Capital");
  });

  it("PARTNERS-VAL-02 (WP-C): email is now required — a name-only partner is rejected", () => {
    expect(PartnerCreateSchema.safeParse({ name: "Solo" }).success).toBe(false);
    const ok = PartnerCreateSchema.parse({ name: "Solo", email: "solo@example.com" });
    expect(ok.email).toBe("solo@example.com");
  });

  it("PARTNERS-VAL-03 (WP-C): rejects a malformed AND a blank email, accepts a valid one", () => {
    expect(PartnerCreateSchema.safeParse({ name: "X", email: "not-an-email" }).success).toBe(false);
    expect(PartnerCreateSchema.safeParse({ name: "X", email: "" }).success).toBe(false);
    expect(PartnerCreateSchema.parse({ name: "X", email: "a@b.co" }).email).toBe("a@b.co");
  });
});

describe("PartnerUpdateSchema", () => {
  it("PARTNERS-VAL-04: allows partial updates (with the now-required email) and never accepts color/status", () => {
    const ok = PartnerUpdateSchema.parse({ email: "x@y.co", dealTerms: "50/50" });
    expect(ok.dealTerms).toBe("50/50");
    // color + status are locked / lifecycle-managed — not editable through this form.
    expect("color" in (ok as Record<string, unknown>)).toBe(false);
    expect("status" in (ok as Record<string, unknown>)).toBe(false);
  });

  it("PARTNERS-VAL-06 (WP-C): update also requires a valid email", () => {
    expect(PartnerUpdateSchema.safeParse({ dealTerms: "50/50" }).success).toBe(false);
    expect(PartnerUpdateSchema.safeParse({ email: "", dealTerms: "50/50" }).success).toBe(false);
  });
});

describe("DeactivateSchema", () => {
  it("PARTNERS-VAL-05: reassign requires a target partner; unmatched does not", () => {
    expect(DeactivateSchema.safeParse({ mode: "reassign" }).success).toBe(false);
    expect(DeactivateSchema.safeParse({ mode: "reassign", toPartnerId: crypto.randomUUID() }).success).toBe(true);
    expect(DeactivateSchema.safeParse({ mode: "unmatched" }).success).toBe(true);
  });
});
