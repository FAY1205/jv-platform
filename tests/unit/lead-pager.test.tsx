// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLeadNav, LeadPager } from "@/app/(admin)/leads/lead-pager";
import type { LeadsPage, LeadRow } from "@/app/(admin)/leads/leads-view";

// N5-04/N5-05 (C-59): the panel's ‹ N of M › pager. The working set is the leads list's
// CURRENT filtered + sorted result — so every number here is derived from one list payload,
// and crossing a table-page boundary has to look like one continuous list to the reader.

const PAGE_SIZE = 2;
// Five leads over three pages: [A,B] [C,D] [E].
const REFS = ["LD-A", "LD-B", "LD-C", "LD-D", "LD-E"];

function row(refId: string): LeadRow {
  return {
    refId, seller: refId, address: "1 Main St", city: "Tulsa", state: "OK", zip: "74105",
    campaign: null, mlsStatus: "kept", status: "New", scoreTotal: null, scoreGroup: null,
    partner: null, receivedAt: "2026-08-01T00:00:00.000Z", modifiedAt: null, tags: [],
  };
}
function pageOf(page: number, total = REFS.length): LeadsPage {
  const start = (page - 1) * PAGE_SIZE;
  return { leads: REFS.slice(start, start + PAGE_SIZE).map(row), page, pageSize: PAGE_SIZE, total };
}

/**
 * Stands in for the leads page: it owns `openRef` and the requested list page. `data` is a
 * PROP so a test can re-render with the neighbour page to model what keepPreviousData does —
 * the payload only flips once the fetch lands, never when the page is requested.
 */
function Harness({ start, data, isError = false }: { start: string | null; data?: LeadsPage; isError?: boolean }) {
  const [openRef, setOpenRef] = React.useState<string | null>(start);
  const [requested, setRequested] = React.useState<number | null>(null);
  const nav = useLeadNav({ data, isError, openRef, onOpen: setOpenRef, onPageChange: setRequested });
  return (
    <div>
      <span data-testid="open">{openRef ?? "none"}</span>
      <span data-testid="requested">{requested === null ? "-" : String(requested)}</span>
      {/* Stands in for the leads table behind the non-modal panel: still there, still
          clickable, while a neighbour page is in flight. */}
      <button type="button" onClick={() => setOpenRef("LD-E")}>Row LD-E</button>
      {nav ? <LeadPager nav={nav} /> : <span data-testid="no-pager" />}
    </div>
  );
}

const prevBtn = () => screen.getByRole("button", { name: "Previous lead" });
const nextBtn = () => screen.getByRole("button", { name: "Next lead" });
const openRef = () => screen.getByTestId("open").textContent;
const requested = () => screen.getByTestId("requested").textContent;
const figure = () => screen.getByRole("group", { name: "Lead navigation" }).textContent;

describe("N5-04: lead pager position + navigation", () => {
  it("N5-04: N of M is the position in the CURRENT working set, not the page", () => {
    render(<Harness start="LD-B" data={pageOf(1)} />);
    expect(figure()).toContain("2 of 5");
  });

  it("N5-04: M is the filtered total — narrowing the filters renumbers the same lead", () => {
    render(<Harness start="LD-B" data={pageOf(1, 3)} />);
    expect(figure()).toContain("2 of 3");
  });

  it("N5-04: within a page, next/prev switch the open lead without touching the list page", async () => {
    const user = userEvent.setup();
    render(<Harness start="LD-A" data={pageOf(1)} />);
    await user.click(nextBtn());
    expect(openRef()).toBe("LD-B");
    expect(requested()).toBe("-");
    await user.click(prevBtn());
    expect(openRef()).toBe("LD-A");
  });

  it("N5-04: the first lead disables Previous — a data boundary, not a permission", () => {
    render(<Harness start="LD-A" data={pageOf(1)} />);
    expect(figure()).toContain("1 of 5");
    expect(prevBtn()).toBeDisabled();
    expect(nextBtn()).toBeEnabled();
  });

  it("N5-04: the last lead of the working set disables Next", () => {
    render(<Harness start="LD-E" data={pageOf(3)} />);
    expect(figure()).toContain("5 of 5");
    expect(nextBtn()).toBeDisabled();
    expect(prevBtn()).toBeEnabled();
  });

  it("N5-04: crossing a page boundary advances the list, then opens the adjacent row when data lands", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness start="LD-B" data={pageOf(1)} />);
    await user.click(nextBtn());

    // The list has been asked for page 2; the payload is still page 1, so nothing has moved.
    expect(requested()).toBe("2");
    expect(openRef()).toBe("LD-B");
    // No double-fire while the neighbour page is in flight.
    expect(nextBtn()).toBeDisabled();
    expect(prevBtn()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);

    rerender(<Harness start="LD-B" data={pageOf(2)} />);
    expect(openRef()).toBe("LD-C");
    expect(figure()).toContain("3 of 5");
    expect(nextBtn()).toBeEnabled();
  });

  it("N5-04: crossing BACKWARD opens the last row of the previous page", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness start="LD-C" data={pageOf(2)} />);
    expect(figure()).toContain("3 of 5");

    await user.click(prevBtn());
    expect(requested()).toBe("1");
    rerender(<Harness start="LD-C" data={pageOf(1)} />);
    expect(openRef()).toBe("LD-B");
    expect(figure()).toContain("2 of 5");
  });

  it("N5-04: a manual row click during a pending page jump wins — the stale neighbor is dropped when data lands", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness start="LD-B" data={pageOf(1)} />);
    // Arrow off the end of page 1: page 2 is requested, LD-C is the pending target.
    await user.click(nextBtn());
    expect(requested()).toBe("2");

    // The table is still clickable behind the non-modal panel — the user picks a different lead.
    await user.click(screen.getByRole("button", { name: "Row LD-E" }));
    expect(openRef()).toBe("LD-E");

    // Page 2 now lands. The jump's target (LD-C) is stale: the later, explicit choice stands.
    rerender(<Harness start="LD-B" data={pageOf(2)} />);
    expect(openRef()).toBe("LD-E");
  });

  it("N5-04: a failed neighbour fetch releases the arrows instead of holding them forever", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness start="LD-B" data={pageOf(1)} />);
    await user.click(nextBtn());
    expect(nextBtn()).toBeDisabled();

    rerender(<Harness start="LD-B" data={pageOf(1)} isError />);
    expect(openRef()).toBe("LD-B");
    expect(nextBtn()).toBeEnabled();
  });
});

describe("N5-05: the pager only speaks for leads inside the working set", () => {
  it("N5-05: a deep-linked lead outside the current filters gets NO pager", () => {
    render(<Harness start="LD-OUTSIDE" data={pageOf(1)} />);
    expect(screen.getByTestId("no-pager")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next lead" })).toBeNull();
  });

  it("N5-05: no list data yet means no pager", () => {
    render(<Harness start="LD-A" />);
    expect(screen.getByTestId("no-pager")).toBeInTheDocument();
  });

  it("N5E-02: the `‹ N of M ›` trio is symmetric — nothing sits between the count and an arrow", () => {
    render(<Harness start="LD-B" data={pageOf(1)} />);
    const group = screen.getByRole("group", { name: "Lead navigation" });
    const kids = [...group.children];
    // The owner saw the group as lopsided: a fixed 14px spinner slot and an sr-only live
    // region were wedged between the count and `›`, padding one side of the figure only.
    expect(kids[0]).toHaveAccessibleName("Previous lead");
    expect(kids[1]).toHaveTextContent("2 of 5");
    expect(kids[2]).toHaveAccessibleName("Next lead");
    // One gap value, applied by the flex container to both sides of the count.
    expect(group.className).toContain("gap-1.5");
    expect(kids[1].className).not.toMatch(/\bp[xl]?-/);
  });

  it("N5E-02: the spinner slot and the live region live AFTER the trio, still reserving width", async () => {
    const user = userEvent.setup();
    render(<Harness start="LD-B" data={pageOf(1)} />);
    await user.click(nextBtn());

    const group = screen.getByRole("group", { name: "Lead navigation" });
    const after = [...group.children].slice(3);
    // Both moved out of the trio…
    expect(after.some((el) => el.getAttribute("role") === "status")).toBe(true);
    // …and the spinner's slot is still FIXED, so a pending jump cannot shift the header.
    const slot = after.find((el) => el.className.includes("w-3.5"))!;
    expect(slot).toBeDefined();
    expect(slot.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("N5-05/N5-30: the arrows name their action and the figure is tabular", () => {
    render(<Harness start="LD-B" data={pageOf(1)} />);
    expect(prevBtn()).toHaveAccessibleName("Previous lead");
    expect(nextBtn()).toHaveAccessibleName("Next lead");
    const fig = screen.getByText(/2 of 5/);
    expect(fig.className).toContain("tabular-nums");
    expect(fig.className).toContain("num");
  });
});
