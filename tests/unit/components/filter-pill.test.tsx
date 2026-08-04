// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterPill } from "@/components/FilterPill";

// D3: the promoted status-filter chip (DSN-03). Pins the toggle semantics and the
// active/idle recipe split so the two former hand-rolled copies can't drift apart again.
describe("DSN-03: FilterPill", () => {
  it("FP-01: renders a toggle button carrying aria-pressed from `active`", () => {
    const { rerender } = render(<FilterPill active={false}>Contacted</FilterPill>);
    const btn = screen.getByRole("button", { name: "Contacted" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveAttribute("type", "button");
    rerender(<FilterPill active>Contacted</FilterPill>);
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("FP-02: active and idle use distinct recipes (brand fill vs bordered surface)", () => {
    const { rerender } = render(<FilterPill active>New</FilterPill>);
    const btn = screen.getByRole("button", { name: "New" });
    expect(btn.className).toContain("bg-brand-soft");
    rerender(<FilterPill>New</FilterPill>);
    expect(btn.className).toContain("bg-surface");
    expect(btn.className).not.toContain("bg-brand-soft");
  });

  it("FP-04: aria-pressed is owned by `active` — a stray caller prop can't override it", () => {
    render(<FilterPill active aria-pressed="mixed">Contacted</FilterPill>);
    expect(screen.getByRole("button", { name: "Contacted" })).toHaveAttribute("aria-pressed", "true");
  });

  it("FP-05: forwards ref to the underlying button (DSN-IB-04 precedent)", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<FilterPill ref={ref}>New</FilterPill>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("FP-06: merges a consumer className (DSN-IB-05 precedent)", () => {
    render(<FilterPill className="ml-2">New</FilterPill>);
    expect(screen.getByRole("button", { name: "New" }).className).toContain("ml-2");
  });

  it("FP-03: fires onClick, and disabled blocks it (DSN-03 disabled state)", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<FilterPill onClick={onClick}>Closed</FilterPill>);
    await user.click(screen.getByRole("button", { name: "Closed" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<FilterPill onClick={onClick} disabled>Closed</FilterPill>);
    await user.click(screen.getByRole("button", { name: "Closed" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
