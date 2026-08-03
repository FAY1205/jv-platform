// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StateMultiSelect, menuPlacement } from "@/components/StateMultiSelect";

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

  it("menuPlacement: opens downward when there's room below (roomy dialog)", () => {
    // Input high in a tall panel: plenty of room below → open down.
    const p = menuPlacement({ top: 200, bottom: 240 }, { top: 80, bottom: 760 });
    expect(p.up).toBe(false);
    expect(p.maxH).toBeGreaterThan(150);
  });

  it("menuPlacement: flips UP when the input sits near the bottom of a short panel (My Territory bug)", () => {
    // Short dialog panel (top 120, bottom 560); input near its bottom → little room below (≈20),
    // more above (≈300). Must flip up and cap height so the menu stays inside the panel.
    const p = menuPlacement({ top: 420, bottom: 460 }, { top: 120, bottom: 480 });
    expect(p.up).toBe(true);
    expect(p.maxH).toBeGreaterThanOrEqual(120);
    expect(p.maxH).toBeLessThanOrEqual(256);
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
