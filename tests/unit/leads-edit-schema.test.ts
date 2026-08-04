import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { EditLeadSchema } from "@/modules/leads/schema";

// Guards the PATCH /api/leads/[ref] input contract. The integration suite exercises
// editLead directly (bypassing the route's Zod parse), so the discriminated union at
// the API boundary needs its own coverage — a dropped literal would silently 400.

describe("EditLeadSchema.partner (PATCH /api/leads/[ref] contract)", () => {
  it("accepts the unassign action (clearing a lead's effective owner)", () => {
    const r = EditLeadSchema.safeParse({ partner: { action: "unassign" } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.partner).toEqual({ action: "unassign" });
  });

  it("accepts keep / set(uuid) / revert actions", () => {
    expect(EditLeadSchema.safeParse({ partner: { action: "keep" } }).success).toBe(true);
    expect(EditLeadSchema.safeParse({ partner: { action: "set", partnerId: randomUUID() } }).success).toBe(true);
    expect(EditLeadSchema.safeParse({ partner: { action: "revert" } }).success).toBe(true);
  });

  it("rejects an unknown partner action", () => {
    expect(EditLeadSchema.safeParse({ partner: { action: "delete" } }).success).toBe(false);
  });

  it("rejects a set action without a valid partner uuid", () => {
    expect(EditLeadSchema.safeParse({ partner: { action: "set", partnerId: "not-a-uuid" } }).success).toBe(false);
  });

  it("defaults partner to keep when omitted", () => {
    const r = EditLeadSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.partner).toEqual({ action: "keep" });
  });
});
