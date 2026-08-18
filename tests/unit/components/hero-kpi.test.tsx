// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroKpi } from "@/components/HeroKpi";

describe("WP-PW-2 HeroKpi", () => {
  it("PW2-01: renders the value and label", () => {
    render(<HeroKpi label="Leads" value={665} />);
    expect(screen.getByText("665")).toBeTruthy();
    expect(screen.getByText("Leads")).toBeTruthy();
  });
  it("PW2-01: formats large numbers with separators", () => {
    render(<HeroKpi label="Leads" value={1284} />);
    expect(screen.getByText("1,284")).toBeTruthy();
  });
  it("PW2-01: shows a prior-window delta only when delta is passed", () => {
    const { rerender } = render(<HeroKpi label="Contacted" value={402} />);
    expect(screen.queryByText(/vs prior/i)).toBeNull();
    rerender(<HeroKpi label="Contacted" value={402} delta={8} />);
    expect(screen.getByText(/vs prior/i)).toBeTruthy();
  });
  it("PW2-01: exposes the calc tooltip label when tip is passed", () => {
    render(<HeroKpi label="Closed" value={57} tip="Leads you marked Closed" />);
    // the label becomes a focusable tooltip trigger
    expect(screen.getByText("Closed").getAttribute("tabindex")).toBe("0");
  });
  it("PW2-final: defaults to px-4, and dense yields px-3 (portal mobile pixel-exactness)", () => {
    const { container, rerender } = render(<HeroKpi label="Leads" value={665} />);
    expect(container.querySelector(".px-4")).toBeTruthy();
    expect(container.querySelector(".px-3")).toBeNull();
    rerender(<HeroKpi label="Leads" value={665} dense />);
    expect(container.querySelector(".px-3")).toBeTruthy();
    expect(container.querySelector(".px-4")).toBeNull();
  });

  // WP-UX-4 (audit D-3): delta sentiment. Colour never rides alone — the arrow + number
  // stay in the text either way (PRN-14); polarity only decides the ink.
  it("UX4-01: a delta in the GOOD direction takes success ink; the bad direction danger", () => {
    const { container, rerender } = render(<HeroKpi label="Leads in" value={86} delta={5} good="up" />);
    expect(container.querySelector(".text-success")?.textContent).toContain("↑ 5");
    rerender(<HeroKpi label="Leads in" value={86} delta={-5} good="up" />);
    expect(container.querySelector(".text-danger")?.textContent).toContain("↓ 5");
    // Inverted polarity: unmatched going DOWN is the good direction.
    rerender(<HeroKpi label="Unmatched" value={1} delta={-3} good="down" />);
    expect(container.querySelector(".text-success")?.textContent).toContain("↓ 3");
  });

  it("UX4-02: no polarity ⇒ neutral ink; zero delta reads “— no change” (the dangling middot is gone)", () => {
    const { container, rerender } = render(<HeroKpi label="Partners" value={13} delta={2} />);
    expect(container.querySelector(".text-success")).toBeNull();
    expect(container.querySelector(".text-danger")).toBeNull();
    rerender(<HeroKpi label="Partners" value={13} delta={0} good="up" />);
    expect(screen.getByText("— no change")).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  // UXF-1.1 (Scope-E audit §1.1): a KPI that counts a list should OPEN that list. The
  // dashboard's range-scoped "New unmatched" tile now points at /unmatched, the same
  // destination as the all-time attention pill above it.
  describe("UXF-1.1: optional href turns the tile into a drill-down", () => {
    it("UXF-1.1: no href ⇒ a plain, non-focusable cell (unchanged default)", () => {
      render(<HeroKpi label="Leads in" value={86} />);
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("UXF-1.1: href renders an anchor over the whole cell — value and label included", () => {
      render(<HeroKpi label="New unmatched" value={7} href="/unmatched" />);
      const a = screen.getByRole("link");
      expect(a.getAttribute("href")).toBe("/unmatched");
      expect(a.textContent).toContain("7");
      expect(a.textContent).toContain("New unmatched");
    });

    it("UXF-1.1: the linked tile carries hover/focus-visible/active states (DSN-03)", () => {
      render(<HeroKpi label="New unmatched" value={7} href="/unmatched" />);
      const a = screen.getByRole("link");
      expect(a.className).toContain("hover:bg-surface-2");
      expect(a.className).toContain("active:bg-surface-2");
      // ring-inset: the tiles sit in an overflow-hidden grid that clips an outset ring.
      expect(a.className).toContain("focus-visible:ring-brand-ink");
      expect(a.className).toContain("focus-visible:ring-inset");
      // The padding/background chrome moved onto the anchor, not a wrapper.
      expect(a.className).toContain("px-4");
      expect(a.className).toContain("bg-surface");
    });

    it("UXF-1.1: with a tip, the LINK is the tooltip trigger — one tab stop, no nested interactive", () => {
      const { container } = render(
        <HeroKpi label="New unmatched" value={7} href="/unmatched" tip="Only the ones that arrived in this range." />,
      );
      const a = screen.getByRole("link");
      // The tooltip is wired to the anchor itself…
      expect(a.getAttribute("aria-describedby")).toBeTruthy();
      expect(screen.getByRole("tooltip", { hidden: true }).textContent).toContain("in this range");
      // …and the dotted-underline HeaderTip span is gone, so nothing focusable nests
      // inside the link.
      expect(a.querySelector("[tabindex]")).toBeNull();
      expect(container.querySelectorAll("[tabindex='0']")).toHaveLength(0);
    });

    it("UXF-1.1: without an href the tip keeps its own HeaderTip trigger", () => {
      render(<HeroKpi label="Closed" value={57} tip="Leads you marked Closed" />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("Closed").getAttribute("tabindex")).toBe("0");
    });
  });
});
