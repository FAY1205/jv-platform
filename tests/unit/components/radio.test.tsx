// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RadioGroup, RadioGroupItem } from "@/components/Radio";

function setup(props?: { value?: string; disabled?: boolean; onValueChange?: (v: string) => void }) {
  const onValueChange = props?.onValueChange ?? vi.fn();
  render(
    <RadioGroup ariaLabel="Where should this go?" value={props?.value ?? "reassign"} onValueChange={onValueChange} disabled={props?.disabled}>
      <RadioGroupItem value="reassign" label="Reassign to another partner" />
      <RadioGroupItem value="unmatched" label="Route to Unmatched" />
    </RadioGroup>,
  );
  return { onValueChange };
}

// Audit design-system F-1: replaces the untokened native <input type="radio"> pair in the
// deactivate/reassign dialog with a tokened, properly-announced radiogroup (DSN-03, PRN-14).
describe("DSN-03: RadioGroup", () => {
  it("RADIO-01: is a labeled radiogroup of radios with the right aria-checked", () => {
    setup({ value: "reassign" });
    expect(screen.getByRole("radiogroup", { name: "Where should this go?" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Reassign to another partner" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Route to Unmatched" })).toHaveAttribute("aria-checked", "false");
  });

  it("RADIO-02: clicking an item selects its value", () => {
    const { onValueChange } = setup({ value: "reassign" });
    fireEvent.click(screen.getByRole("radio", { name: "Route to Unmatched" }));
    expect(onValueChange).toHaveBeenCalledWith("unmatched");
  });

  it("RADIO-03: Space and Enter on a focused item select it", () => {
    const { onValueChange } = setup({ value: "reassign" });
    const unmatched = screen.getByRole("radio", { name: "Route to Unmatched" });
    fireEvent.keyDown(unmatched, { key: " " });
    fireEvent.keyDown(unmatched, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledTimes(2);
    expect(onValueChange).toHaveBeenCalledWith("unmatched");
  });

  it("RADIO-04: each item is keyboard-reachable (tabIndex 0), but a disabled group is inert", () => {
    setup({ value: "reassign" });
    screen.getAllByRole("radio").forEach((r) => expect(r).toHaveAttribute("tabindex", "0"));

    const onValueChange = vi.fn();
    setup({ value: "reassign", disabled: true, onValueChange });
    const disabledRadios = screen.getAllByRole("radio", { name: /Unmatched/ });
    const disabledOne = disabledRadios[disabledRadios.length - 1];
    expect(disabledOne).toHaveAttribute("aria-disabled", "true");
    expect(disabledOne).toHaveAttribute("tabindex", "-1");
    fireEvent.click(disabledOne);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
