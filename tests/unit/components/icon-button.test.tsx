// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { IconButton } from "@/components/IconButton";

const Icon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="9" />
  </svg>
);

describe("DSN-03: IconButton", () => {
  it("DSN-IB-01: exposes its aria-label as the accessible name", () => {
    render(<IconButton aria-label="Toggle navigation"><Icon /></IconButton>);
    expect(screen.getByRole("button", { name: "Toggle navigation" })).toBeTruthy();
  });

  it("DSN-IB-02: loading sets aria-busy + disabled and swaps the icon for a spinner", () => {
    render(<IconButton aria-label="Search" loading><Icon data-testid="icon" /></IconButton>);
    const btn = screen.getByRole("button", { name: "Search" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("icon")).toBeNull();
    expect(btn.querySelector("svg.animate-spin")).toBeTruthy();
  });

  it("DSN-IB-03: disabled does not fire onClick", () => {
    const onClick = vi.fn();
    render(<IconButton aria-label="Search" disabled onClick={onClick}><Icon /></IconButton>);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("DSN-IB-04: forwards ref to the underlying button (Radix asChild contract)", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<IconButton aria-label="Search" ref={ref}><Icon /></IconButton>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("DSN-IB-05: merges a consumer className and passes through aria-expanded", () => {
    render(<IconButton aria-label="Menu" className="ml-2" aria-expanded><Icon /></IconButton>);
    const btn = screen.getByRole("button", { name: "Menu" });
    expect(btn.className).toContain("ml-2");
    expect(btn.className).toContain("h-11");
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("DSN-IB-06: defaults type to button (never submits a form)", () => {
    render(<IconButton aria-label="Menu"><Icon /></IconButton>);
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("type", "button");
  });
});
