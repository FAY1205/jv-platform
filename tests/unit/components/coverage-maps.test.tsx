// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { CountyCoverageMap } from "@/components/CountyCoverageMap";
import { PARTNER_FILL_OPACITY, DIMMED_FILL_OPACITY } from "@/components/map";
import type { StateCoverage } from "@/modules/coverage/map";

// D1 (2026-07-15): the hex-cartogram CoverageMap (and its describe block here) was
// retired — the county choropleth below is the app's one map (owner map-consistency
// call, T3). Its hover tooltip, hatch, opacity, and caption behavior are pinned here.

function stateRow(over: Partial<StateCoverage> & Pick<StateCoverage, "code" | "name">): StateCoverage {
  return {
    code: over.code,
    name: over.name,
    partnerId: over.partnerId ?? null,
    partnerName: over.partnerName ?? null,
    refId: over.refId ?? null,
    color: over.color ?? null,
    leadCount: over.leadCount ?? 0,
    gap: over.gap ?? false,
  };
}

describe("MAP-01: CountyCoverageMap (county) — Survey reskin", () => {
  const GEO = {
    viewBox: "0 0 960 600",
    counties: [
      { f: "06001", n: "Alameda", d: "M0 0h10v10h-10z" }, // CA
      { f: "48001", n: "Anderson", d: "M20 0h10v10h-10z" }, // TX
    ],
    borders: "M0 0h960v600h-960z",
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(GEO) })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  async function renderMap(props: Partial<React.ComponentProps<typeof CountyCoverageMap>> & { states: readonly StateCoverage[] }) {
    const view = render(<CountyCoverageMap {...props} />);
    await waitFor(() => expect(view.container.querySelectorAll("path[data-fips]").length).toBe(2));
    return view;
  }

  it("MAP-01: defines the hatch and fills uncovered counties with it", async () => {
    const { container } = await renderMap({ states: [] });
    expect(container.querySelector("pattern")).toBeInTheDocument();
    const hatched = [...container.querySelectorAll("path[data-fips]")].filter((p) =>
      (p.getAttribute("fill") || "").startsWith("url(#"),
    );
    expect(hatched.length).toBe(2);
  });

  it("MAP-01: softens covered counties to the shared fill opacity", async () => {
    const states: StateCoverage[] = [
      stateRow({ code: "CA", name: "California", partnerId: "p1", partnerName: "Acme", refId: "PR-001", color: "#5B7A9E" }),
    ];
    const { container } = await renderMap({ states });
    const covered = container.querySelector('path[data-fips="06001"]')!;
    expect(covered.getAttribute("fill-opacity")).toBe(String(PARTNER_FILL_OPACITY));
    const uncovered = container.querySelector('path[data-fips="48001"]')!;
    expect((uncovered.getAttribute("fill") || "").startsWith("url(#")).toBe(true);
  });

  it("MAP-01: dims non-selected territory to the shared dim opacity", async () => {
    const states: StateCoverage[] = [
      stateRow({ code: "CA", name: "California", partnerId: "p1", partnerName: "A", refId: "PR-001", color: "#5B7A9E" }),
      stateRow({ code: "TX", name: "Texas", partnerId: "p2", partnerName: "B", refId: "PR-002", color: "#6E8B5E" }),
    ];
    const { container } = await renderMap({ states, selectedPartnerId: "p1" });
    const selected = container.querySelector('path[data-fips="06001"]')!; // CA / p1
    const other = container.querySelector('path[data-fips="48001"]')!; // TX / p2 → dimmed
    expect(selected.getAttribute("fill-opacity")).toBe(String(PARTNER_FILL_OPACITY));
    expect(other.getAttribute("fill-opacity")).toBe(String(DIMMED_FILL_OPACITY));
  });

  it("MAP-01: exposes role=img and renders a caption when provided", async () => {
    render(<CountyCoverageMap states={[]} caption={{ title: "United States", subtitle: "county coverage" }} />);
    expect(await screen.findByRole("img", { name: /county coverage map/i })).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
  });

  // ── uncoveredHoverLabel (T3: the Unmatched gap map overrides the coverage wording) ──

  it("MAP-01: hovering an uncovered state's county shows the default coverage wording", async () => {
    const states: StateCoverage[] = [stateRow({ code: "TX", name: "Texas" })]; // present, no partner
    const { container } = await renderMap({ states });
    fireEvent.pointerMove(container.querySelector('path[data-fips="48001"]')!);
    expect(await screen.findByText("No partner covers Texas")).toBeInTheDocument();
  });

  it("T3/MAP-01: uncoveredHoverLabel overrides the uncovered wording (gap-map semantics)", async () => {
    const states: StateCoverage[] = [stateRow({ code: "TX", name: "Texas" })];
    const { container } = await renderMap({
      states,
      uncoveredHoverLabel: (name) => `No unmatched leads in ${name}`,
    });
    fireEvent.pointerMove(container.querySelector('path[data-fips="48001"]')!);
    expect(await screen.findByText("No unmatched leads in Texas")).toBeInTheDocument();
    expect(screen.queryByText("No partner covers Texas")).toBeNull();
  });

  it("MAP-01: a covered county's hover shows the partner token, never the uncovered wording", async () => {
    const states: StateCoverage[] = [
      stateRow({ code: "CA", name: "California", partnerId: "p1", partnerName: "Acme", refId: "PR-001", color: "#5B7A9E" }),
    ];
    const { container } = await renderMap({ states, uncoveredHoverLabel: (n) => `custom ${n}` });
    fireEvent.pointerMove(container.querySelector('path[data-fips="06001"]')!);
    expect(await screen.findByText("Acme")).toBeInTheDocument(); // PartnerTag (PRN-14: name + ref)
    expect(screen.getByText("PR-001")).toBeInTheDocument();
    expect(screen.queryByText(/custom/)).toBeNull();
  });
});
