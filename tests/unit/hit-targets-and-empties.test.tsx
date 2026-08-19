// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox, CHECKBOX_HIT_AREA } from "@/components/Checkbox";
import { FilterPill } from "@/components/FilterPill";
import { ClearFiltersButton } from "@/components/ClearFiltersButton";
import { EmptyState } from "@/components/EmptyState";
import { ScrollHintFade } from "@/components/ScrollHint";

// WP-N3B. Hit areas are geometry, and jsdom has no layout engine — getBoundingClientRect is
// always 0×0 and pseudo-elements are never resolved — so a "≥24px" assertion here would be
// vacuous (the deep-audit's own vacuous-sweep trap). What IS worth locking is the CONTRACT the
// geometry rests on: the expansion rides on an ABSOLUTE pseudo-element (layout-neutral by
// construction, which is the property that makes it safe inside the two 44px <label> wrappers),
// and it never adds padding/margin that would move a neighbor. The pixel result is verified in
// the browser and noted in the gallery + PR.

const HIT_AREA_RE = /before:absolute/;
/** Any utility that would consume LAYOUT space and shift neighbours. */
const LAYOUT_SHIFTING = /(?:^|\s)-?(?:p|m)[trblxy]?-/;

describe("N3B-01/C-52: pointer hit targets", () => {
  it("N3B-01/C-52: Checkbox expands its hit area on a pseudo-element, not with padding", () => {
    render(<Checkbox checked={false} onCheckedChange={() => {}} ariaLabel="Pick me" />);
    const box = screen.getByRole("checkbox", { name: "Pick me" });
    // The exported contract is what the component actually applies.
    for (const cls of CHECKBOX_HIT_AREA.split(" ")) expect(box.className).toContain(cls);
    expect(box.className).toMatch(HIT_AREA_RE);
    // `relative` is required or the absolute pseudo-element would escape to the page.
    expect(box.className).toMatch(/(?:^|\s)relative(?:\s|$)/);
    // Layout-neutral: no padding/margin utility anywhere on the box (this is the property
    // that keeps it inert inside TasksPanel/MyTasksList's 44px labels).
    expect(box.className).not.toMatch(LAYOUT_SHIFTING);
    // The 16px visual box is unchanged.
    expect(box.className).toContain("h-4");
    expect(box.className).toContain("w-4");
  });

  it("N3B-01/C-52: FilterPill expands vertically only, so wrapped chip rows can't steal taps", () => {
    render(<FilterPill>New</FilterPill>);
    const pill = screen.getByRole("button", { name: "New" });
    expect(pill.className).toMatch(HIT_AREA_RE);
    expect(pill.className).toContain("before:-inset-y-1");
    // `inset-x-0` is load-bearing: without it the absolute pseudo-element collapses to zero
    // width and the taller hit area reaches nothing (caught in the browser, not by types).
    expect(pill.className).toContain("before:inset-x-0");
    // Zero horizontal REACH though: neighbouring chips sit 6px apart in a wrapping row / a
    // scroll strip, so the expansion must never be all-round (`-inset-N`) or negative-x.
    expect(pill.className).not.toMatch(/before:-inset-(?:x-|\d)/);
    // Padding is untouched — the chip still draws at its original size.
    expect(pill.className).toContain("px-2.5");
    expect(pill.className).toContain("py-0.5");
  });

  it("N3B-01/C-52: the expanded hit area still activates the control", async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} ariaLabel="Pick me" />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Pick me" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("N3B-02/C-53: horizontal scroll hint", () => {
  it("N3B-02/C-53: the fade is inert to pointers and hidden from assistive tech", () => {
    const { container } = render(<ScrollHintFade />);
    const fade = container.querySelector("[data-testid='table-more-right']");
    expect(fade).not.toBeNull();
    // It sits ON TOP of the scroller's right edge — it must never eat a click on the row
    // (or a chip) underneath it.
    expect(fade!.className).toContain("pointer-events-none");
    expect(fade).toHaveAttribute("aria-hidden", "true");
    // Tokened gradient, both themes (PRN-12): a semantic surface token, never a literal colour.
    expect(fade!.className).toContain("from-surface");
    expect(fade!.className).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("N3B-02/C-53: `from` picks the surface the strip actually sits on", () => {
    const { container } = render(<ScrollHintFade from="bg" />);
    const fade = container.querySelector("[data-testid='table-more-right']")!;
    expect(fade.className).toContain("from-bg");
    expect(fade.className).not.toContain("from-surface");
  });
});

describe("N3B-03/C-54: filtered-to-zero empties offer a way out", () => {
  it("N3B-03/C-54: ClearFiltersButton renders the shared label and fires its handler", async () => {
    const onClick = vi.fn();
    render(<ClearFiltersButton onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Clear filters" });
    // A bare <button> inside a <form> would submit it; the primitive owns type="button".
    expect(btn).toHaveAttribute("type", "button");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("N3B-03/C-54: a disabled ClearFiltersButton swallows activation (DSN-03)", async () => {
    const onClick = vi.fn();
    render(<ClearFiltersButton onClick={onClick} disabled />);
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("N3B-03/C-54: EmptyState surfaces the button in its action slot", () => {
    render(
      <EmptyState
        title="No leads found"
        description="Try widening the filters."
        action={<ClearFiltersButton onClick={() => {}} />}
      />,
    );
    // role="status" — the empty state announces on the async settle, action included.
    expect(screen.getByRole("status")).toContainElement(screen.getByRole("button", { name: "Clear filters" }));
  });

  it("N3B-03/C-54: no action slot means no stray button on a genuinely empty list", () => {
    render(<EmptyState title="No imports yet" description="Process a weekly file to see it here." action={undefined} />);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });
});
