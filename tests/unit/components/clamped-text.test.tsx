// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClampedText } from "@/components/ClampedText";

// jsdom computes no layout, so scrollHeight/clientHeight are always 0. Override the
// prototype getters to simulate whether the clamped text overflows.
function setMetrics(scrollH: number, clientH: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => scrollH });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => clientH });
}

afterEach(() => {
  setMetrics(0, 0);
});

describe("ClampedText: long source notes clamp + show-more (DSN-03)", () => {
  it("renders text with NO toggle when it fits the clamp", () => {
    setMetrics(100, 100); // content is no taller than the clamp
    render(<ClampedText>short note</ClampedText>);
    expect(screen.getByText("short note")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
  });

  it("shows a 'Show more' toggle when the clamped text overflows", () => {
    setMetrics(300, 100); // content taller than the clamp
    render(<ClampedText>{"a long note ".repeat(200)}</ClampedText>);
    expect(screen.getByRole("button", { name: /show more/i })).toBeTruthy();
  });

  it("expands and collapses, tracking aria-expanded", () => {
    setMetrics(300, 100);
    render(<ClampedText>{"a long note ".repeat(200)}</ClampedText>);

    const more = screen.getByRole("button", { name: /show more/i });
    expect(more.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(more);
    const less = screen.getByRole("button", { name: /show less/i });
    expect(less.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(less);
    expect(screen.getByRole("button", { name: /show more/i }).getAttribute("aria-expanded")).toBe("false");
  });
});
