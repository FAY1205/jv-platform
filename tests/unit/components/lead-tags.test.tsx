// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeadTags } from "@/components/LeadTags";

// WP-TAG-1 (TAG-04/TAG-05) component coverage: the chip row's own behaviour — chips render,
// ✕ detaches, the ＋ picker type-aheads and creates inline, the board card's cap collapses to
// "+n", and the Hot SMART tag renders from the score with NO ✕ (the one chip you cannot
// remove, because there is nothing stored to remove).
//
// Radix Popover (the picker) uses ResizeObserver + pointer-capture APIs jsdom lacks; stub them.
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

const PROBATE = { id: "t1", name: "Probate", color: "teal" };
const FOLLOW = { id: "t2", name: "Follow-up", color: "blue" };
const CASH = { id: "t3", name: "Cash buyer ask", color: "plum" };
const ALL = [PROBATE, FOLLOW, CASH];

describe("TAG-04: the lead chip row", () => {
  it("renders a chip per tag, with the NAME always present (PRN-14)", () => {
    render(<LeadTags tags={[PROBATE, FOLLOW]} />);
    expect(screen.getByText("Probate")).toBeInTheDocument();
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
  });

  it("TAG-04: ✕ detaches the chip it belongs to, and never bubbles to the row behind it", async () => {
    const user = userEvent.setup();
    const onDetach = vi.fn();
    const onRowClick = vi.fn();
    render(
      // The chips live inside a clickable row on both real surfaces — a detach must not
      // also open the lead.
      <div onClick={onRowClick}>
        <LeadTags editable tags={[PROBATE, FOLLOW]} options={ALL} onAttach={vi.fn()} onDetach={onDetach} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Remove tag Follow-up" }));
    expect(onDetach).toHaveBeenCalledExactlyOnceWith("t2");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("a read-only row shows no ✕ and no ＋", () => {
    render(<LeadTags tags={[PROBATE]} options={ALL} />);
    expect(screen.queryByRole("button", { name: /remove tag/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add a tag/i })).toBeNull();
  });

  it("a mutation in flight disables the ✕ and the ＋ (nothing moves under the cursor)", () => {
    render(<LeadTags editable busy tags={[PROBATE]} options={ALL} onAttach={vi.fn()} onDetach={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove tag Probate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /add a tag/i })).toBeDisabled();
  });
});

describe("TAG-04: the ＋ picker", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: /add a tag/i }));

  it("type-ahead filters the roster, and a tag already on the lead is not offered again", async () => {
    const user = userEvent.setup();
    render(<LeadTags editable tags={[PROBATE]} options={ALL} onAttach={vi.fn()} onDetach={vi.fn()} onCreate={vi.fn()} />);
    await open(user);

    const listbox = screen.getByRole("listbox");
    // Probate is attached → absent from the options (only the chip carries it).
    expect(within(listbox).queryByRole("option", { name: /probate/i })).toBeNull();
    expect(within(listbox).getByRole("option", { name: /follow-up/i })).toBeInTheDocument();

    await user.type(screen.getByRole("combobox"), "cash");
    expect(within(screen.getByRole("listbox")).queryByRole("option", { name: /follow-up/i })).toBeNull();
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: /cash buyer ask/i })).toBeInTheDocument();
  });

  it("selecting an option attaches it by ID", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    render(<LeadTags editable tags={[]} options={ALL} onAttach={onAttach} onDetach={vi.fn()} />);
    await open(user);
    await user.click(screen.getByRole("option", { name: /follow-up/i }));
    expect(onAttach).toHaveBeenCalledExactlyOnceWith("t2");
  });

  it("TAG-04: create-inline offers the typed name — and only when it isn't already a tag", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<LeadTags editable tags={[]} options={ALL} onAttach={vi.fn()} onDetach={vi.fn()} onCreate={onCreate} />);
    await open(user);

    await user.type(screen.getByRole("combobox"), "fol");
    expect(screen.getByRole("option", { name: /create “fol”/i })).toBeInTheDocument();

    // An exact (case-insensitive) match offers no create row — names are unique per tenant.
    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "follow-UP");
    expect(screen.queryByRole("option", { name: /create/i })).toBeNull();

    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "Probate lead");
    await user.click(screen.getByRole("option", { name: /create “probate lead”/i }));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("Probate lead");
  });

  it("the create row is reachable from the KEYBOARD (arrow past the options, Enter)", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<LeadTags editable tags={[]} options={[PROBATE]} onAttach={vi.fn()} onDetach={vi.fn()} onCreate={onCreate} />);
    await open(user);
    await user.type(screen.getByRole("combobox"), "New label");
    // One option matches nothing, so the create row is the only row — Enter takes it.
    await user.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("New label");
  });

  it("the filter-row variant has no create-inline (a filter can only select what exists)", async () => {
    const user = userEvent.setup();
    render(<LeadTags editable tags={[]} options={ALL} onAttach={vi.fn()} onDetach={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add a tag/i }));
    await user.type(screen.getByRole("combobox"), "brand new");
    expect(screen.queryByRole("option", { name: /create/i })).toBeNull();
  });
});

describe("TAG-04/TAG-05: the card cap and the Hot smart tag", () => {
  it("TAG-04: a capped row shows 2 chips + '+n', with the hidden names in the label", () => {
    render(<LeadTags tags={ALL} max={2} />);
    expect(screen.getByText("Probate")).toBeInTheDocument();
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
    // No CHIP for the third tag (its name still lives in the overflow marker's tooltip,
    // which is why this probes the chip element rather than the text).
    expect(document.querySelector('[data-tag-chip="Cash buyer ask"]')).toBeNull();
    // The overflow marker keeps the information — it is not lost to truncation.
    expect(screen.getByLabelText("1 more tags: Cash buyer ask")).toBeInTheDocument();
  });

  it("TAG-05: Hot renders from the SCORE, in the chip vocabulary, with NO ✕", () => {
    render(<LeadTags editable tags={[PROBATE]} hot hotScore={42} options={ALL} onAttach={vi.fn()} onDetach={vi.fn()} />);
    const hot = screen.getByRole("img", { name: /hot lead — 42 out of 50/i });
    expect(hot).toBeInTheDocument();
    // Its accessible name says WHY it can't be removed…
    expect(hot).toHaveAccessibleName(/not an editable tag/i);
    // …and there is exactly one ✕ on the row: the stored tag's.
    const removes = screen.getAllByRole("button", { name: /remove tag/i });
    expect(removes.map((b) => b.getAttribute("aria-label"))).toEqual(["Remove tag Probate"]);
  });

  it("TAG-05: no Hot chip without a score — an unscored or non-hot lead shows none", () => {
    const { rerender } = render(<LeadTags tags={[]} hot hotScore={null} />);
    expect(screen.queryByRole("img", { name: /hot lead/i })).toBeNull();
    rerender(<LeadTags tags={[]} hot={false} hotScore={44} />);
    expect(screen.queryByRole("img", { name: /hot lead/i })).toBeNull();
  });
});
