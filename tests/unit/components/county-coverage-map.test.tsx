// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stubGeoFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(GEO), { status: 200, headers: { "content-type": "application/json" } })),
  );

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

// WP-UX-4 / ADR-0050 — the opt-in on-map state-label layer. The PRN-14 fix for the Unmatched
// choropleth: every shaded state carries its code AND its count on an opaque backing chip, so
// magnitude is never conveyed by shade alone. The layer is opt-in precisely so /coverage,
// /dashboard and the portal map keep byte-identical DOM — pinned by the first test here.
describe("CountyCoverageMap — MAP-06 state label layer", () => {
  const STATES = [stateEntry("TX", "Texas"), stateEntry("CA", "California")];

  const renderMap = async (props: Partial<React.ComponentProps<typeof CountyCoverageMap>> = {}) => {
    stubGeoFetch();
    const utils = render(<CountyCoverageMap states={STATES} interactive={false} {...props} />);
    await waitFor(() => expect(utils.container.querySelector('path[data-fips="48113"]')).toBeTruthy());
    return utils;
  };

  it("MAP-06: no stateLabels prop ⇒ no label layer DOM at all", async () => {
    const { container } = await renderMap();
    expect(container.querySelector("[data-map-labels]")).toBeNull();
  });

  it('MAP-06 / PRN-14: each labeled state renders "{CODE} · {count}"', async () => {
    const { container } = await renderMap({ stateLabels: [{ code: "TX", text: "TX · 7" }, { code: "CA", text: "CA · 1" }] });
    const layer = container.querySelector("[data-map-labels]")!;
    expect(layer).toBeTruthy();
    expect(layer.textContent).toContain("TX · 7");
    expect(layer.textContent).toContain("CA · 1");
  });

  it("MAP-06 / PRN-12: the chip consumes semantic tokens, never a hex", async () => {
    const { container } = await renderMap({ stateLabels: [{ code: "TX", text: "TX · 7" }] });
    const chip = container.querySelector('[data-map-label="TX"]')!;
    const rect = chip.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("var(--surface)");
    expect(rect.getAttribute("stroke")).toBe("var(--border-strong)");
    expect(rect.getAttribute("rx")).toBe("4");

    const tspans = [...chip.querySelectorAll("tspan")];
    expect(tspans.map((t) => t.getAttribute("fill"))).toEqual(["var(--text-2)", "var(--text-3)", "var(--text)"]);
    // The count — the datum — gets the max-contrast ink at 600.
    const count = tspans[2];
    expect(count.textContent).toBe("7");
    expect(count.getAttribute("font-weight")).toBe("600");
  });

  it("MAP-06: chip width is the pure function of character count (7.8 × chars + 14)", async () => {
    const { container } = await renderMap({ stateLabels: [{ code: "TX", text: "TX · 7" }] });
    const rect = container.querySelector('[data-map-label="TX"] rect')!;
    expect(Number(rect.getAttribute("width"))).toBeCloseTo(60.8, 5); // 6 chars × 7.8 + 14
    expect(Number(rect.getAttribute("height"))).toBe(20);
    expect(Number(rect.getAttribute("x"))).toBeCloseTo(-30.4, 5); // centered on the anchor
  });

  it("MAP-06: the layer is presentational — aria-hidden and pointer-events none", async () => {
    const { container } = await renderMap({ stateLabels: [{ code: "TX", text: "TX · 7" }] });
    const layer = container.querySelector("[data-map-labels]")! as SVGElement;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    // Labels must never eat the data-fips hover/click delegation underneath them.
    expect(layer.style.pointerEvents || layer.getAttribute("pointer-events")).toBe("none");
  });

  it("MAP-06: callout states draw a leader line; in-place states don't", async () => {
    const callout = await renderMap({ stateLabels: [{ code: "RI", text: "RI · 2" }] });
    expect(callout.container.querySelectorAll("[data-map-labels] line")).toHaveLength(1);
    callout.unmount();

    const inPlace = await renderMap({ stateLabels: [{ code: "TX", text: "TX · 7" }] });
    expect(inPlace.container.querySelectorAll("[data-map-labels] line")).toHaveLength(0);
  });

  it("MAP-06: an unknown state code is skipped and does not throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = await renderMap({ stateLabels: [{ code: "ZZ", text: "ZZ · 3" }] });
    expect(container.querySelector("[data-map-labels]")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("MAP-06: labels counter-scale under zoom so the chip stays 13px", async () => {
    // jsdom reports a zero-size box; give the map a real one so zoomAt can do its math.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 960, height: 600, top: 0, left: 0, right: 960, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    const { container, getByLabelText } = await renderMap({ interactive: true, stateLabels: [{ code: "TX", text: "TX · 7" }] });
    const chip = () => container.querySelector('[data-map-label="TX"]')!.getAttribute("transform")!;

    expect(chip()).toBe("translate(487.5 463.5) scale(1)"); // at rest, s = 1
    fireEvent.click(getByLabelText("Zoom in"));
    await waitFor(() => expect(chip()).not.toContain("scale(1)"));

    // The zoom group grew by s; the chip shrank by exactly 1/s, so it renders at a constant size.
    const zoomGroup = container.querySelector("svg > g[transform]")!.getAttribute("transform")!;
    const s = Number(/scale\(([\d.]+)\)/.exec(zoomGroup)![1]);
    const inverse = Number(/scale\(([\d.]+)\)/.exec(chip())![1]);
    expect(s).toBeGreaterThan(1);
    expect(inverse).toBeCloseTo(1 / s, 10);
    // The anchor itself never moves — it stays glued to the geometry.
    expect(chip()).toContain("translate(487.5 463.5)");
  });
});
