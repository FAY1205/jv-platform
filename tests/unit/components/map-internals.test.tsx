// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MapHatch, MapCaption } from "@/components/map";

afterEach(() => cleanup());

describe("MAP-01: MapHatch", () => {
  it("MAP-01: renders a <pattern> with the supplied id", () => {
    const { container } = render(
      <svg>
        <MapHatch id="hx1" />
      </svg>,
    );
    expect(container.querySelector("pattern#hx1")).toBeInTheDocument();
  });
});

describe("MAP-01: MapCaption", () => {
  it("MAP-01: always renders the title", () => {
    render(<MapCaption title="United States" />);
    expect(screen.getByText("United States")).toBeInTheDocument();
  });

  it("MAP-01: renders the subtitle only when provided", () => {
    const { rerender } = render(<MapCaption title="United States" />);
    expect(screen.queryByText("50 states")).toBeNull();
    rerender(<MapCaption title="United States" subtitle="50 states" />);
    expect(screen.getByText("50 states")).toBeInTheDocument();
  });
});
