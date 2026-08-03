// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StateMultiSelect } from "@/components/StateMultiSelect";

// Radix Popover (the menu) uses ResizeObserver + pointer-capture APIs jsdom lacks; stub them.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

// WP-C: the searchable state picker. Picking from the fixed list makes an invalid state
// impossible — the whole point of replacing the free-text box.
function Harness({ initial = [] as string[] }) {
  const [sel, setSel] = React.useState<string[]>(initial);
  return <StateMultiSelect selected={sel} onChange={setSel} />;
}

describe("StateMultiSelect", () => {
  it("renders a searchable combobox input", () => {
    render(<Harness />);
    expect(screen.getByRole("combobox", { name: /add states/i })).toBeTruthy();
  });

  it("clicking the input opens the menu and it STAYS open (anchor interactions are not 'outside')", async () => {
    // Regression (owner report): the input is a Popover ANCHOR, so Radix used to treat focus on it
    // as an outside interaction and dismiss the menu the instant it opened (open-close flicker).
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: /add states/i });

    await user.click(input);
    expect(await screen.findByRole("listbox")).toBeTruthy();

    // A second click on the already-focused input must not close it either.
    await user.click(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("picks states from the list and shows them as chips (invalid input is impossible)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: /add states/i });

    await user.click(input);
    await user.type(input, "tex");
    await user.click(await screen.findByRole("option", { name: /texas/i }));

    await user.type(input, "calif");
    await user.click(await screen.findByRole("option", { name: /california/i }));

    const chips = screen.getByRole("list", { name: /selected states/i });
    expect(within(chips).getByText("TX")).toBeTruthy();
    expect(within(chips).getByText("CA")).toBeTruthy();
  });

  it("does not offer an already-selected state again", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["TX"]} />);
    const input = screen.getByRole("combobox", { name: /add states/i });
    await user.click(input);
    await user.type(input, "texas");
    expect(screen.queryByRole("option", { name: /texas/i })).toBeNull();
  });

  it("renders the selected chips ABOVE the search input (so the dropdown can't cover them)", () => {
    render(<Harness initial={["TX"]} />);
    const chips = screen.getByRole("list", { name: /selected states/i });
    const combo = screen.getByRole("combobox", { name: /add states/i });
    // The chips list precedes the combobox in document order → it renders above it.
    expect(chips.compareDocumentPosition(combo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("removes a state when its chip's remove button is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["TX", "CA"]} />);
    await user.click(screen.getByRole("button", { name: /remove tx/i }));

    const chips = screen.getByRole("list", { name: /selected states/i });
    expect(within(chips).queryByText("TX")).toBeNull();
    expect(within(chips).getByText("CA")).toBeTruthy();
  });
});
