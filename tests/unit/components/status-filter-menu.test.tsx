// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// WP-UX-6 (owner direction): the status filter as a multi-select — a calm summary trigger
// + removable deviation chips, replacing the wall of active pills. Radix menu needs a few
// DOM APIs jsdom lacks; stub them (the tag-picker test's precedent).
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
}

import { StatusFilterMenu } from "@/components/StatusFilterMenu";

const OPTS = ["New", "Contacted", "Appointment", "Under contract", "Closed", "Dead", "Removed MLS"];
const DEFAULT = OPTS.filter((s) => s !== "Removed MLS"); // admin default

function Harness({ initial }: { initial: string[] }) {
  const [value, setValue] = React.useState(initial);
  return <StatusFilterMenu options={OPTS} defaultValue={DEFAULT} value={value} onChange={setValue} />;
}

describe("StatusFilterMenu (WP-UX-6)", () => {
  it("UX6-04: the default selection reads 'All active' and shows NO deviation chips", () => {
    render(<Harness initial={DEFAULT} />);
    expect(screen.getByRole("button", { name: /All active/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove status/ })).toBeNull();
  });

  it("UX6-05: a narrowed selection summarizes and renders one removable chip per status", () => {
    render(<Harness initial={["New", "Contacted"]} />);
    // 1–2 selected → the names summary.
    expect(screen.getByRole("button", { name: /New \+ Contacted/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove status New" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove status Contacted" })).toBeInTheDocument();
  });

  it("UX6-06: 3+ selected collapse to an 'N of 7' summary; empty reads 'Any status'", () => {
    // Controlled renders — the summary is a pure function of `value`, no internal state.
    const { unmount } = render(
      <StatusFilterMenu options={OPTS} defaultValue={DEFAULT} value={["New", "Contacted", "Closed"]} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /3 of 7/ })).toBeInTheDocument();
    unmount();
    render(<StatusFilterMenu options={OPTS} defaultValue={DEFAULT} value={[]} onChange={vi.fn()} />);
    // "Any status" appears twice (trigger summary + the reset chip) — target the trigger.
    expect(screen.getByRole("button", { name: /Status: Any status/ })).toBeInTheDocument();
  });

  it("UX6-07: removing a chip deselects that status (chip removal drives onChange)", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["New", "Contacted"]} />);
    await user.click(screen.getByRole("button", { name: "Remove status Contacted" }));
    // Contacted's chip is gone; New's remains, and the summary follows to the single value.
    expect(screen.queryByRole("button", { name: "Remove status Contacted" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove status New" })).toBeInTheDocument();
  });

  it("UX6-08: the menu toggles a status as a checkbox item and stays open for several", async () => {
    const user = userEvent.setup();
    render(<Harness initial={DEFAULT} />);
    await user.click(screen.getByRole("button", { name: /All active/ }));
    const removed = await screen.findByRole("menuitemcheckbox", { name: "Removed MLS" });
    expect(removed).toHaveAttribute("aria-checked", "false");
    await user.click(removed);
    // Still open — the other items are still queryable after a toggle.
    expect(screen.getByRole("menuitemcheckbox", { name: "New" })).toHaveAttribute("aria-checked", "true");
  });
});
