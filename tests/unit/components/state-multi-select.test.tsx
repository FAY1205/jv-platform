// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StateMultiSelect } from "@/components/StateMultiSelect";

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

  it("removes a state when its chip's remove button is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["TX", "CA"]} />);
    await user.click(screen.getByRole("button", { name: /remove tx/i }));

    const chips = screen.getByRole("list", { name: /selected states/i });
    expect(within(chips).queryByText("TX")).toBeNull();
    expect(within(chips).getByText("CA")).toBeTruthy();
  });
});
