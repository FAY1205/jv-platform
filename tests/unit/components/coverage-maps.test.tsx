// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CoverageMap } from "@/components/CoverageMap";
import { CountyCoverageMap } from "@/components/CountyCoverageMap";
import { PARTNER_FILL_OPACITY, DIMMED_FILL_OPACITY } from "@/components/map";
import { contrastText } from "@/lib/contrast";
import type { StateCoverage } from "@/modules/coverage/map";

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

const COVERED = stateRow({
  code: "CA",
  name: "California",
  partnerId: "p1",
  partnerName: "Acme",
  refId: "PR-001",
  color: "#5B7A9E",
  leadCount: 3,
});
const GAP = stateRow({ code: "TX", name: "Texas", gap: true, leadCount: 5 });

afterEach(() => cleanup());

describe("MAP-01: CoverageMap (hex) — Survey reskin", () => {
  it("MAP-01: defines the uncovered hatch pattern", () => {
    const { container } = render(<CoverageMap states={[COVERED, GAP]} />);
    expect(container.querySelector("pattern")).toBeInTheDocument();
  });

  it("MAP-01: fills uncovered states with the hatch (url reference)", () => {
    const { container } = render(<CoverageMap states={[COVERED, GAP]} />);
    const hatched = [...container.querySelectorAll("polygon")].filter((p) =>
      (p.getAttribute("fill") || "").startsWith("url(#"),
    );
    expect(hatched.length).toBeGreaterThan(0);
  });

  it("MAP-01: keeps the warn ring + marker dot on gap states only", () => {
    const { container } = render(<CoverageMap states={[COVERED, GAP]} />);
    const dashed = [...container.querySelectorAll("polygon")].filter((p) => p.getAttribute("stroke-dasharray"));
    expect(dashed.length).toBe(1); // only TX gap
    expect(container.querySelector("circle")).toBeInTheDocument(); // marker dot
  });

  it("MAP-01: labels covered states via the shared contrast picker (F-19)", () => {
    const { container } = render(<CoverageMap states={[COVERED, GAP]} />);
    const ca = [...container.querySelectorAll("text")].find((t) => t.textContent === "CA")!;
    // jsdom serializes inline style.fill to rgb(); tie the assertion to the picker's choice.
    const asRgb = (hex: "#111111" | "#ffffff") => (hex === "#ffffff" ? "rgb(255, 255, 255)" : "rgb(17, 17, 17)");
    expect(ca.style.fill).toBe(asRgb(contrastText("#5B7A9E")));
  });

  it("MAP-01: exposes role=img with a descriptive label", () => {
    render(<CoverageMap states={[COVERED, GAP]} />);
    expect(screen.getByRole("img", { name: /coverage map/i })).toBeInTheDocument();
  });

  it("MAP-01: renders the caption plate only when a caption is provided", () => {
    const { rerender } = render(<CoverageMap states={[COVERED]} />);
    expect(screen.queryByText("United States")).toBeNull();
    rerender(<CoverageMap states={[COVERED]} caption={{ title: "United States", subtitle: "50 states" }} />);
    expect(screen.getByText("United States")).toBeInTheDocument();
    expect(screen.getByText("50 states")).toBeInTheDocument();
  });
});

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

  it("MAP-01: defines the hatch and fills uncovered counties with it", async () => {
    const { container } = render(<CountyCoverageMap states={[]} />);
    await waitFor(() => expect(container.querySelectorAll("path[data-fips]").length).toBe(2));
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
    const { container } = render(<CountyCoverageMap states={states} />);
    await waitFor(() => expect(container.querySelectorAll("path[data-fips]").length).toBe(2));
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
    const { container } = render(<CountyCoverageMap states={states} selectedPartnerId="p1" />);
    await waitFor(() => expect(container.querySelectorAll("path[data-fips]").length).toBe(2));
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
});
