import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE } from "@/components/Pagination";
import {
  PORTAL_LEADS_DEFAULTS,
  PORTAL_LEADS_DEFAULT_PAGE_SIZE,
  portalLeadsKey,
  portalLeadsParams,
  portalLeadsUrl,
} from "@/modules/portal/leads-contract";

// C-41a: the portal-leads read has ONE canonical shape. Three callers (mobile list, desktop
// table, dashboard preview) used to ask the same default question three different ways —
// three keys, three urls, zero cache sharing. These tests pin the single shape they now share.

describe("C-41a: canonical portal-leads query shape", () => {
  it("C-41a: the canonical page size IS the Pagination primitive's default", () => {
    // leads-contract cannot import the client barrel, so the constant is restated there.
    // This is the pin that keeps the restatement honest — if either moves, the desktop
    // table's opening page would stop matching the dashboard preview's.
    expect(PORTAL_LEADS_DEFAULT_PAGE_SIZE).toBe(DEFAULT_PAGE_SIZE);
  });

  it("C-41a: the dashboard preview and a freshly-opened leads list share one key and one url", () => {
    // The preview asks for the defaults; a list opens on page 1 with no filters.
    const preview = portalLeadsParams();
    const listOnOpen = portalLeadsParams({
      page: 1,
      pageSize: PORTAL_LEADS_DEFAULT_PAGE_SIZE,
      sort: "received",
      dir: "desc",
      statuses: [],
      q: "",
    });
    expect(portalLeadsKey(listOnOpen)).toEqual(portalLeadsKey(preview));
    expect(portalLeadsUrl(listOnOpen)).toBe(portalLeadsUrl(preview));
    expect(portalLeadsUrl(preview)).toBe("/api/portal/leads?page=1&pageSize=20&sort=received&dir=desc");
  });

  it("C-41a: params normalize — status order and untrimmed search never fork the cache", () => {
    const a = portalLeadsParams({ statuses: ["Contacted", "New"], q: "  Ruiz " });
    const b = portalLeadsParams({ statuses: ["New", "Contacted"], q: "Ruiz" });
    expect(portalLeadsKey(a)).toEqual(portalLeadsKey(b));
    expect(portalLeadsUrl(a)).toBe(portalLeadsUrl(b));
  });

  it("C-41a: filters travel on the url only when set, always under the ['portal-leads'] prefix", () => {
    const url = portalLeadsUrl(portalLeadsParams({ page: 3, statuses: ["New"], q: "Ruiz" }));
    expect(url).toContain("page=3");
    expect(url).toContain("status=New");
    expect(url).toContain("q=Ruiz");
    expect(portalLeadsUrl(PORTAL_LEADS_DEFAULTS)).not.toContain("status=");
    expect(portalLeadsUrl(PORTAL_LEADS_DEFAULTS)).not.toContain("q=");
    // The prefix is what the dialog's placeholder lookup scans (C-41b).
    expect(portalLeadsKey(PORTAL_LEADS_DEFAULTS)[0]).toBe("portal-leads");
  });
});
