// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagPicker, type TagPickerOption } from "@/components/TagPicker";
import { nextTagColor } from "@/lib/tokens/tokens";

// C-24 — TagPicker had ZERO direct coverage (only its behaviour *through* LeadTags was
// exercised). It is the surface the tag roster is actually used from, it owns a hand-rolled
// ARIA combobox, and C-24 adds three behaviours to it (keyboard scroll-follow, the roster
// count line, the at-cap hint). Cover it on its own terms.
//
// Radix Popover uses ResizeObserver + pointer-capture APIs jsdom lacks; stub them. The
// keyboard scroll-follow needs a real spy on scrollIntoView (jsdom has no layout at all).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
const scrollIntoView = vi.fn();
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView = scrollIntoView;
}

const PROBATE = { id: "t1", name: "Probate", color: "teal", leadCount: 14 };
const FOLLOW = { id: "t2", name: "Follow-up", color: "blue", leadCount: 3 };
const CASH = { id: "t3", name: "Cash buyer ask", color: "plum", leadCount: 0 };
const ALL: TagPickerOption[] = [PROBATE, FOLLOW, CASH];

/** n sortable options — the "roster at scale" fixture (the audit seed is 53). */
const mk = (n: number): TagPickerOption[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `g${i}`,
    name: `Tag ${String(i).padStart(2, "0")}`,
    color: nextTagColor(i),
    leadCount: i,
  }));

beforeEach(() => {
  scrollIntoView.mockClear();
});

function setup(props: Partial<React.ComponentProps<typeof TagPicker>> = {}) {
  const onSelect = props.onSelect ?? vi.fn();
  const utils = render(
    <TagPicker options={ALL} selectedIds={[]} {...props} onSelect={onSelect} />,
  );
  return { ...utils, onSelect };
}

const openPicker = async (user: ReturnType<typeof userEvent.setup>, label = "Add a tag") => {
  await user.click(screen.getByRole("button", { name: label }));
  return screen.getByRole("combobox");
};

describe("TAG-04: TagPicker — roster, filtering, selection", () => {
  it("TAG-04: renders the roster and filters case-insensitively as the user types", async () => {
    const user = userEvent.setup();
    setup();
    const input = await openPicker(user);
    expect(screen.getAllByRole("option")).toHaveLength(3);

    await user.type(input, "PRO");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Probate"),
    ]);

    await user.clear(input);
    await user.type(input, "zzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("TAG-04: selected ids are hidden from the list", async () => {
    const user = userEvent.setup();
    setup({ selectedIds: [PROBATE.id] });
    await openPicker(user);
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: /probate/i })).toBeNull();
    expect(within(listbox).getAllByRole("option")).toHaveLength(2);
  });

  it("TAG-04: create-inline appears for a new name and is suppressed for an existing one — including one already on the lead", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    setup({ onCreate, selectedIds: [PROBATE.id] });
    const input = await openPicker(user);

    await user.type(input, "Vacant");
    expect(screen.getByRole("option", { name: /create “Vacant”/i })).toBeInTheDocument();

    // An exact match in a different CASE offers no create row…
    await user.clear(input);
    await user.type(input, "follow-UP");
    expect(screen.queryByRole("option", { name: /create/i })).toBeNull();

    // …and neither does one that is already ON the lead (it isn't even in the list).
    await user.clear(input);
    await user.type(input, "PROBATE");
    expect(screen.queryByRole("option", { name: /create/i })).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("TAG-04: full keyboard path — arrows move the highlight, Enter picks, Enter on the create row creates, Escape closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    render(<TagPicker options={ALL} selectedIds={[]} onSelect={onSelect} onCreate={onCreate} />);
    let input = await openPicker(user);

    // ArrowDown ×2 lands on the THIRD visible row, Enter attaches it by id.
    await user.type(input, "{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(CASH.id);

    // The create row is the last stop of the SAME arrow run. (Picking closed and reset the
    // menu, so reopening starts from a clean type-ahead — that is the real gesture.)
    input = await openPicker(user);
    await user.type(input, "Vacant");
    await user.type(input, "{ArrowDown}{Enter}"); // 0 matches ⇒ the create row is row 0
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("Vacant");

    // Escape closes the menu without selecting anything more.
    input = await openPicker(user);
    await user.type(input, "{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("PRN-14: every row carries the tag name as text beside an aria-hidden colour dot", async () => {
    const user = userEvent.setup();
    setup();
    await openPicker(user);
    for (const t of ALL) {
      const row = screen.getByRole("option", { name: new RegExp(t.name, "i") });
      expect(within(row).getByText(t.name)).toBeInTheDocument();
      // The dot is decorative: it adds nothing to the accessible name, so no row is
      // communicating by colour alone.
      const dot = row.querySelector("[aria-hidden='true']");
      expect(dot).not.toBeNull();
      expect(dot?.className).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it("TAG-04: busy/disabled — the trigger disables and the menu does not open", async () => {
    const { unmount } = setup({ busy: true });
    expect(screen.getByRole("button", { name: "Add a tag" })).toBeDisabled();
    unmount();

    const user = userEvent.setup();
    setup({ disabled: true });
    const trigger = screen.getByRole("button", { name: "Add a tag" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("TAG-04: combobox wiring — role, listbox ids, aria-activedescendant tracks the arrows", async () => {
    const user = userEvent.setup();
    setup();
    const input = await openPicker(user);
    const listboxId = screen.getByRole("listbox").id;

    expect(input).toHaveAttribute("aria-controls", listboxId);
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-activedescendant", `${listboxId}-0`);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("id", `${listboxId}-0`);

    await user.type(input, "{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", `${listboxId}-1`);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  });
});

describe("FEP-03/TAG-09: TagPicker at roster scale", () => {
  it("FEP-03: keyboard navigation keeps the active row visible in the scroller", async () => {
    const user = userEvent.setup();
    const options = mk(53);
    setup({ options });
    const input = await openPicker(user);
    const listboxId = screen.getByRole("listbox").id;
    // Radix's own open/focus handling may scroll; only what the ARROW keys do is under test.
    scrollIntoView.mockClear();

    await user.type(input, "{ArrowDown}{ArrowDown}{ArrowDown}");
    // The LAST follow targeted the row the highlight actually landed on. Waited-on as the
    // assertion itself: waitFor(toHaveBeenCalled) resolves on the FIRST call, and under CI
    // timing the third keypress's effect may not have flushed yet (flaked on verify).
    await waitFor(() => expect(scrollIntoView.mock.instances.at(-1)).toBe(document.getElementById(`${listboxId}-3`)));
    // "nearest" = the minimal correction; a row already on screen must not jump.
    for (const call of scrollIntoView.mock.calls) expect(call[0]).toEqual({ block: "nearest" });

    // …and hovering must NOT scroll: yanking the list out from under a moving cursor is
    // exactly the bug the keyboard-only placement avoids.
    scrollIntoView.mockClear();
    await user.hover(screen.getAllByRole("option")[10]);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("TAG-09: shows the roster count line only past 25 tags, and it tracks the filter", async () => {
    const user = userEvent.setup();
    const { unmount } = setup({ options: mk(10) });
    await openPicker(user);
    // Below the threshold the line is noise, not signal.
    expect(screen.queryByText(/type to filter/i)).toBeNull();
    unmount();

    setup({ options: mk(53) });
    const input = await openPicker(user);
    expect(screen.getByText("53 tags — type to filter")).toBeInTheDocument();

    // "Tag 0X" matches Tag 00..Tag 09 — ten of the fifty-three.
    await user.type(input, "Tag 0");
    expect(screen.getByText("10 of 53 match")).toBeInTheDocument();
    expect(screen.queryByText(/type to filter/i)).toBeNull();
  });
});

describe("TAG-08: TagPicker at the tag limit", () => {
  it("TAG-08: at the tag limit the create row is replaced by the limit hint and Enter cannot create", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    setup({ atLimit: true, onCreate });
    const input = await openPicker(user);
    const listboxId = screen.getByRole("listbox").id;

    // "a" matches Probate and Cash buyer ask — two real options, and a name that is NOT a tag.
    await user.type(input, "a");
    expect(screen.getByText("Tag limit reached — manage tags in Settings.")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /create/i })).toBeNull();
    // The hint is INERT: not an option, so it is not in the arrow run…
    expect(screen.getAllByRole("option")).toHaveLength(2);

    // …and repeated ArrowDown clamps to the last REAL option rather than reaching it.
    await user.type(input, "{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", `${listboxId}-1`);

    await user.type(input, "{Enter}");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("TAG-08: atLimit does not disturb picking existing tags", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TagPicker options={ALL} selectedIds={[]} atLimit onSelect={onSelect} onCreate={vi.fn()} />);
    await openPicker(user);
    await user.click(screen.getByRole("option", { name: /follow-up/i }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(FOLLOW.id);
  });
});
