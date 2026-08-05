import { describe, it, expect } from "vitest";
import { toExportLead, type ExportLeadSource } from "@/modules/export/render";

// R-11 / EXP-SS: one serializer builds the fixed export row for BOTH the admin run download
// and the partner portal export, so the two contracts can't silently drift. The partner path
// blanks Campaign (lead source is admin-only, PRN-08); everything else is identical.
const base: ExportLeadSource = {
  refId: "LD-26-1",
  campaign: "Zolo",
  dateCreated: "2026-08-01",
  notes: "called",
  address: "1 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  sellerFirst: "Sam",
  sellerLast: "Rivers",
  phone: "5125550100",
  email: "sam@example.com",
  reasonForSelling: "relocating",
  motivation: "high",
  timeToSell: "30d",
  partnerId: "p1",
  possibleMlsListing: "no",
};

describe("R-11: toExportLead serializer", () => {
  it("admin path preserves Campaign and maps refId -> leadRefId", () => {
    const out = toExportLead(base);
    expect(out.campaign).toBe("Zolo");
    expect(out.leadRefId).toBe("LD-26-1");
    expect(out.partnerId).toBe("p1");
    expect(out.possibleMlsListing).toBe("no");
  });

  it("PRN-08: blankCampaign strips the lead source and changes nothing else", () => {
    const admin = toExportLead(base);
    const portal = toExportLead(base, { blankCampaign: true });
    expect(portal).toEqual({ ...admin, campaign: "" });
  });

  it("coalesces null/undefined text fields to empty strings (never null in the .xlsx)", () => {
    const sparse: ExportLeadSource = { refId: "LD-26-2", partnerId: null, possibleMlsListing: "pending" };
    const out = toExportLead(sparse);
    expect(out.campaign).toBe("");
    expect(out.dateCreated).toBe("");
    expect(out.notes).toBe("");
    expect(out.address).toBe("");
    expect(out.sellerFirst).toBe("");
    expect(out.email).toBe("");
    expect(out.partnerId).toBeNull();
  });
});
