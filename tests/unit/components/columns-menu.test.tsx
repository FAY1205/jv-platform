// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColumnsMenu, type ColumnDef } from "@/components/ColumnsMenu";

// Radix Dropdown needs the pointer APIs jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const COLUMNS: ColumnDef[] = [
  { id: "lead", label: "Lead", pinned: true },
  { id: "seller", label: "Seller" },
  { id: "property", label: "Property" },
  { id: "status", label: "Status", pinned: true },
];

function setup(hidden: string[] = []) {
  const onToggle = vi.fn();
  const onReset = vi.fn();
  render(<ColumnsMenu columns={COLUMNS} hidden={hidden} onToggle={onToggle} onReset={onReset} />);
  return { onToggle, onReset };
}

describe("ColumnsMenu", () => {
  it("shows the hidden count in words on the trigger (PRN-14), or nothing at default", () => {
    const { rerender } = render(<ColumnsMenu columns={COLUMNS} hidden={[]} onToggle={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByRole("button", { name: /choose columns/i })).toHaveTextContent(/^Columns$/);
    rerender(<ColumnsMenu columns={COLUMNS} hidden={["seller", "property"]} onToggle={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByRole("button", { name: /choose columns/i })).toHaveTextContent("2 hidden");
  });

  it("pinned columns render checked + disabled; a toggleable one reports the new visibility", async () => {
    const user = userEvent.setup();
    const { onToggle } = setup(["seller"]);
    await user.click(screen.getByRole("button", { name: /choose columns/i }));

    // Lead + Status are pinned: checked and not operable.
    const lead = await screen.findByRole("menuitemcheckbox", { name: /lead/i });
    expect(lead).toHaveAttribute("aria-checked", "true");
    expect(lead).toHaveAttribute("data-disabled");

    // Seller is hidden (unchecked); clicking it asks to SHOW it.
    const seller = screen.getByRole("menuitemcheckbox", { name: /seller/i });
    expect(seller).toHaveAttribute("aria-checked", "false");
    await user.click(seller);
    expect(onToggle).toHaveBeenCalledWith("seller", true);

    // Property is visible; clicking it asks to HIDE it — and the menu stays open (no close).
    await user.click(screen.getByRole("menuitemcheckbox", { name: /property/i }));
    expect(onToggle).toHaveBeenCalledWith("property", false);
    expect(screen.getByRole("menuitemcheckbox", { name: /seller/i })).toBeInTheDocument();
  });

  it("Reset to default is disabled at the default and resets otherwise", async () => {
    const user = userEvent.setup();
    // At default (nothing hidden) the reset is present but disabled.
    setup([]);
    await user.click(screen.getByRole("button", { name: /choose columns/i }));
    const resetDisabled = await screen.findByRole("menuitem", { name: /reset to default/i });
    expect(resetDisabled).toHaveAttribute("data-disabled");
    await user.keyboard("{Escape}");

    // With a column hidden, reset fires.
    const { onReset } = setup(["seller"]);
    await user.click(screen.getAllByRole("button", { name: /choose columns/i })[1]);
    await user.click(await screen.findByRole("menuitem", { name: /reset to default/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
