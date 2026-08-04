// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { CountyCoverageMap } from "@/components/CountyCoverageMap";
import type { StateCoverage } from "@/modules/coverage/map";

// WP-E: a county a partner covers by ZIP colors at county level, overriding the state fallback.
const GEO = {
  viewBox: "0 0 960 600",
  counties: [
    { f: "48113", n: "Dallas", d: "M0 0h1v1z" }, // TX
    { f: "06037", n: "Los Angeles", d: "M2 2h1v1z" }, // CA
  ],
  borders: "",
};

const stateEntry = (code: string, name: string): StateCoverage => ({
  code,
  name,
  partnerId: null,
  partnerName: null,
  refId: null,
  color: null,
  leadCount: 0,
  gap: false,
});

afterEach(() => vi.unstubAllGlobals());

describe("CountyCoverageMap — WP-E county overlay", () => {
  it("fills a ZIP-covered county with the partner color and leaves an uncovered county to the fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(GEO), { status: 200, headers: { "content-type": "application/json" } })),
    );

    // Both states uncovered at state level — so any county color must come from the ZIP overlay.
    const states = [stateEntry("TX", "Texas"), stateEntry("CA", "California")];
    const counties = [{ fips: "48113", partnerId: "p1", partnerName: "Alpha", refId: "PR-001", color: "#abcabc" }];

    const { container } = render(<CountyCoverageMap states={states} counties={counties} interactive={false} />);
    await waitFor(() => expect(container.querySelector('path[data-fips="48113"]')).toBeTruthy());

    const dallas = container.querySelector('path[data-fips="48113"]')!;
    const la = container.querySelector('path[data-fips="06037"]')!;
    expect(dallas.getAttribute("fill")).toBe("#abcabc"); // ZIP-covered county → partner color
    expect(la.getAttribute("fill")).not.toBe("#abcabc"); // no coverage → hatch, not the color
  });
});
