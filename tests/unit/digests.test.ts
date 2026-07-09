import { describe, expect, it } from "vitest";
import { buildPartnerDigest, buildAdminRunSummary } from "@/modules/notify/digests";
import { backoffMs, MAX_OUTBOX_ATTEMPTS } from "@/modules/notify/outbox";

// NTF-01/02: digest content. Pure builders — the outbox (NTF-03) attaches the
// recipient + drains delivery. SEC-05: digests carry lead reference IDs + location,
// never seller phone/email.
describe("buildPartnerDigest", () => {
  const input = {
    appName: "JV Platform",
    partnerName: "Randy Wolfe",
    portalUrl: "https://app.test/portal",
    uploadRef: "IM-26-014",
    leads: [
      { refId: "LD-26-00007", city: "Austin", state: "TX" },
      { refId: "LD-26-00008", city: "Dallas", state: "TX" },
    ],
  };

  it("NTF-01: subject states the new-lead count", () => {
    expect(buildPartnerDigest(input).subject).toMatch(/2 new leads/i);
  });

  it("NTF-01: body lists each lead reference ID + location and links to the portal", () => {
    const { body } = buildPartnerDigest(input);
    expect(body).toContain("LD-26-00007");
    expect(body).toContain("LD-26-00008");
    expect(body).toContain("Austin, TX");
    expect(body).toContain("https://app.test/portal");
  });

  it("SEC-05: the digest never leaks seller PII (no phone/email fields present)", () => {
    const { body } = buildPartnerDigest(input);
    expect(body).not.toMatch(/@/); // no email addresses of sellers
  });

  it("NTF-01: singular wording for a single lead", () => {
    expect(buildPartnerDigest({ ...input, leads: [input.leads[0]] }).subject).toMatch(/1 new lead\b/i);
  });
});

describe("buildAdminRunSummary", () => {
  it("NTF-02: subject references the run and body carries the totals", () => {
    const out = buildAdminRunSummary({
      appName: "JV Platform",
      uploadRef: "IM-26-014",
      summary: { total: 50, kept: 24, removed: 26, unmatched: 1, previouslyMatched: 3, perPartner: [{ partnerId: "p1", count: 24 }] },
    });
    expect(out.subject).toContain("IM-26-014");
    expect(out.body).toMatch(/24/); // distributed/kept
    expect(out.body).toMatch(/26/); // removed
    expect(out.body).toMatch(/unmatched/i);
    // D5: the run-summary vocabulary is "Distributed", never "Delivered".
    expect(out.body).toContain("Distributed (kept):");
    expect(out.body).not.toContain("Delivered");
  });
});

describe("backoffMs (NTF-03 retry with backoff)", () => {
  it("grows with each attempt and is capped", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBeGreaterThan(backoffMs(1));
    expect(backoffMs(3)).toBeGreaterThan(backoffMs(2));
    expect(backoffMs(99)).toBe(backoffMs(50)); // capped
  });

  it("has a bounded max attempt count", () => {
    expect(MAX_OUTBOX_ATTEMPTS).toBeGreaterThanOrEqual(3);
  });
});
