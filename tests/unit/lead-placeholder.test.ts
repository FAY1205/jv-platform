import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { adminLeadPlaceholder, leadDetailFromRow } from "@/app/(admin)/leads/lead-placeholder";
import { portalLeadDetailFromRow, portalLeadPlaceholder } from "@/app/portal/leads/portal-lead-placeholder";
import { portalLeadsKey, portalLeadsParams, type PartnerLeadRow } from "@/modules/portal/leads-contract";
import type { LeadRow } from "@/app/(admin)/leads/leads-view";

// C-41b: the lead dialogs paint from the list row while the detail loads. The list and the
// detail genuinely disagree on shape (admin row = ONE seller string, portal row = first/last,
// detail = a nested seller object), so each dialog gets its OWN explicit reshape — these are
// the tests that keep those reshapes honest.

const ADMIN_ROW: LeadRow = {
  refId: "LD-26-00929",
  seller: "Robert Thompson",
  address: "8193 Maple St",
  city: "Dallas",
  state: "TX",
  zip: "75045",
  campaign: "Direct mail",
  mlsStatus: "kept",
  status: "New",
  scoreTotal: 41,
  scoreGroup: "hot",
  partner: { id: "p1", name: "Meridian Buyers", refId: "JV-001", color: "#5B7A9E" },
  receivedAt: "2026-08-13T10:00:00.000Z",
  modifiedAt: null,
  tags: [],
};

const PORTAL_ROW: PartnerLeadRow = {
  refId: "LD-26-00930",
  sellerFirst: "Ana",
  sellerLast: "Ruiz",
  address: "12 Elm St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  receivedAt: "2026-08-12T10:00:00.000Z",
  status: "Contacted",
  scoreTotal: null,
  scoreGroup: null,
};

describe("C-41b: admin lead placeholder", () => {
  it("C-41b: splits the row's ONE seller string back into first/last, losslessly for display", () => {
    const d = leadDetailFromRow(ADMIN_ROW);
    expect(d.seller.first).toBe("Robert");
    expect(d.seller.last).toBe("Thompson");
    // What the dialog actually renders must equal what the row showed.
    expect(`${d.seller.first} ${d.seller.last}`.trim()).toBe(ADMIN_ROW.seller);
  });

  it("C-41b: a multi-word or single-word name still re-joins to the row's string", () => {
    for (const seller of ["Mary Jane Watson", "Cher", ""]) {
      const d = leadDetailFromRow({ ...ADMIN_ROW, seller });
      expect(`${d.seller.first} ${d.seller.last}`.trim()).toBe(seller);
    }
  });

  it("C-41b: the list's em-dash placeholders become empty strings, not a literal '—'", () => {
    const d = leadDetailFromRow({ ...ADMIN_ROW, seller: "—", address: "—", city: null, campaign: null });
    expect(d.seller.first).toBe("");
    expect(d.address).toBe("");
    expect(d.city).toBe("");
    expect(d.campaign).toBe("");
  });

  it("C-41b: carries what the row knows and leaves detail-only fields empty", () => {
    const d = leadDetailFromRow(ADMIN_ROW);
    expect(d.refId).toBe("LD-26-00929");
    expect(d.status).toBe("New");
    expect(d.partner).toEqual(ADMIN_ROW.partner);
    expect(d.score.total).toBe(41);
    expect(d.score.group).toBe("hot");
    expect(d.editable).toBe(true);
    // Detail-only — the dialog skeletons these rather than showing them as known-empty.
    expect(d.seller.phone).toBe("");
    expect(d.reasonForSelling).toBe("");
    expect(d.score.breakdown).toBeNull();
    expect(d.score.status).toBe("incomplete");
    expect(d.activity).toEqual([]);
  });

  it("C-41b: finds the row in any cached list page, and returns undefined when nothing is cached", () => {
    const qc = new QueryClient();
    expect(adminLeadPlaceholder(qc, "LD-26-00929")).toBeUndefined();
    qc.setQueryData(["leads", "somefilter|desc", 2, 20], { leads: [ADMIN_ROW], page: 2, pageSize: 20, total: 1 });
    // The nav-count entry lives under the same prefix and must be skipped, not crashed on.
    qc.setQueryData(["leads", "counts"], { total: 1, unmatched: 0 });
    expect(adminLeadPlaceholder(qc, "LD-26-00929")?.refId).toBe("LD-26-00929");
    expect(adminLeadPlaceholder(qc, "LD-26-99999")).toBeUndefined();
  });
});

describe("C-41b: portal lead placeholder", () => {
  it("C-41b: nests the row's separate sellerFirst/sellerLast under seller{}", () => {
    const d = portalLeadDetailFromRow(PORTAL_ROW);
    expect(d.seller).toEqual({ first: "Ana", last: "Ruiz", phone: "", email: "" });
    expect(d.address).toBe("12 Elm St");
    expect(d.status).toBe("Contacted");
  });

  it("C-41b: leaves every detail-only section empty for the dialog to skeleton", () => {
    const d = portalLeadDetailFromRow(PORTAL_ROW);
    expect(d.history).toEqual([]);
    expect(d.activity).toEqual([]);
    expect(d.notes).toBe("");
    expect(d.timeToSell).toBe("");
    expect(d.listing).toEqual({ status: "pending", link: null });
  });

  it("C-41b: reads the C-41a canonical key, so a row opened from the dashboard preview also seeds", () => {
    const qc = new QueryClient();
    expect(portalLeadPlaceholder(qc, PORTAL_ROW.refId)).toBeUndefined();
    // The preview's own entry — same key the leads list uses (C-41a).
    qc.setQueryData(portalLeadsKey(portalLeadsParams()), { leads: [PORTAL_ROW], page: 1, pageSize: 20, total: 1 });
    expect(portalLeadPlaceholder(qc, PORTAL_ROW.refId)?.seller.last).toBe("Ruiz");
    expect(portalLeadPlaceholder(qc, "LD-26-00000")).toBeUndefined();
  });
});
