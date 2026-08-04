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
});
