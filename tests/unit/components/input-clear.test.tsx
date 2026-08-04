// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "@/components/Input";

// VP-5+: the leads search box gets a ✕ to clear it — added to the shared Input primitive
// (opt-in via onClear) so every search field can reuse it. The ✕ shows only when there is
// something to clear.
describe("VP-5+: Input onClear affordance", () => {
  it("shows a clear ✕ only when onClear is set AND the field has a value", () => {
    const { rerender } = render(<Input value="" onChange={() => {}} onClear={() => {}} aria-label="Search" />);
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
    rerender(<Input value="acme" onChange={() => {}} onClear={() => {}} aria-label="Search" />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeTruthy();
  });

  it("does not show the ✕ without onClear even when there is a value", () => {
    render(<Input value="acme" onChange={() => {}} aria-label="Search" />);
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });

  it("calls onClear when the ✕ is clicked", () => {
    const onClear = vi.fn();
    render(<Input value="acme" onChange={() => {}} onClear={onClear} aria-label="Search" />);
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
