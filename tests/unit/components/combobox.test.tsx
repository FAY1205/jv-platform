// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "@/components";

// DSN-03 coverage for the searchable single-select (T2, owner note #2 — the state
// filter). ARIA 1.2 combobox pattern: filtering, pointer + keyboard selection,
// Escape revert, and the clear affordance.

const OPTS = [
  { value: "TX", label: "Texas (TX)" },
  { value: "TN", label: "Tennessee (TN)" },
  { value: "FL", label: "Florida (FL)" },
];

function setup(value = "", onValueChange = vi.fn()) {
  render(<Combobox ariaLabel="Filter by state" placeholder="All states" options={OPTS} value={value} onValueChange={onValueChange} />);
  return { input: screen.getByRole("combobox", { name: "Filter by state" }), onValueChange };
}

describe("Combobox (DSN-03)", () => {
  it("DSN-03: closed by default; typing opens and filters the options", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    expect(input).toHaveAttribute("aria-expanded", "false");

    await user.type(input, "te");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Texas (TX)", "Tennessee (TN)"]);
  });

  it("DSN-03: clicking an option selects it and shows its label", async () => {
    const user = userEvent.setup();
    const { input, onValueChange } = setup();
    await user.type(input, "flor");
    await user.click(screen.getByRole("option", { name: "Florida (FL)" }));
    expect(onValueChange).toHaveBeenCalledWith("FL");
    expect(input).toHaveValue("Florida (FL)");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("DSN-03: ArrowDown + Enter selects with the keyboard", async () => {
    const user = userEvent.setup();
    const { input, onValueChange } = setup();
    await user.type(input, "t");
    await user.keyboard("{ArrowDown}{Enter}"); // active moves Texas -> Tennessee
    expect(onValueChange).toHaveBeenCalledWith("TN");
  });

  it("DSN-03: Escape closes and reverts half-typed text to the selection", async () => {
    const user = userEvent.setup();
    const { input } = setup("TX");
    expect(input).toHaveValue("Texas (TX)");
    await user.type(input, "zzz");
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("Texas (TX)");
  });

  it("DSN-03: the clear button empties the selection", async () => {
    const user = userEvent.setup();
    const { onValueChange } = setup("TX");
    await user.click(screen.getByRole("button", { name: "Clear filter by state" }));
    expect(onValueChange).toHaveBeenCalledWith("");
  });

  it("DSN-03: no matches shows an explicit empty row, not a silent void", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "xyz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
