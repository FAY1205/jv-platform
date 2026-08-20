// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

/** Stands in for the leads page: it owns `openRef` and the list page, and — like the real
 *  query with keepPreviousData — keeps showing the previous page's payload until `land()`. */
let land: (page: number, total?: number) => void;
let fail: () => void;

/** `data0: null` = the list query has no data yet (first load / board mode). */
function Harness({ start, data0 }: { start: string | null; data0?: LeadsPage | null }) {
  const [data, setData] = React.useState<LeadsPage | undefined>(data0 === undefined ? pageOf(1) : (data0 ?? undefined));
  const [isError, setIsError] = React.useState(false);
  const [openRef, setOpenRef] = React.useState<string | null>(start);
  const [requested, setRequested] = React.useState<number | null>(null);
  land = (page, total) => act(() => setData(pageOf(page, total)));
  fail = () => act(() => setIsError(true));

  const nav = useLeadNav({ data, isError, openRef, onOpen: setOpenRef, onPageChange: setRequested });
  return (
    <div>
      <span data-testid="open">{openRef ?? "none"}</span>
      <span data-testid="requested">{requested === null ? "-" : String(requested)}</span>
      {nav ? <LeadPager nav={nav} /> : <span data-testid="no-pager" />}
    </div>
  );
}

const prevBtn = () => screen.getByRole("button", { name: "Previous lead" });
const nextBtn = () => screen.getByRole("button", { name: "Next lead" });
const openRef = () => screen.getByTestId("open").textContent;
const figure = () => screen.getByRole("group", { name: "Lead navigation" }).textContent;

describe("N5-04: lead pager position + navigation", () => {
  it("N5-04: N of M is the position in the CURRENT working set, not the page", () => {
    render(<Harness start="LD-B" />);
    expect(figure()).toContain("2 of 5");
  });

  it("N5-04: M is the filtered total — narrowing the filters renumbers the same lead", () => {
    render(<Harness start="LD-B" data0={pageOf(1, 3)} />);
    expect(figure()).toContain("2 of 3");
  });

  it("N5-04: within a page, next/prev switch the open lead without touching the list page", async () => {
    const user = userEvent.setup();
    render(<Harness start="LD-A" />);
    await user.click(nextBtn());
    expect(openRef()).toBe("LD-B");
    expect(screen.getByTestId("requested").textContent).toBe("-");
    await user.click(prevBtn());
    expect(openRef()).toBe("LD-A");
  });

  it("N5-04: the first lead disables Previous — a data boundary, not a permission", () => {
    render(<Harness start="LD-A" />);
    expect(figure()).toContain("1 of 5");
    expect(prevBtn()).toBeDisabled();
    expect(nextBtn()).toBeEnabled();
  });

  it("N5-04: the last lead of the working set disables Next", () => {
    render(<Harness start="LD-E" data0={pageOf(3)} />);
    expect(figure()).toContain("5 of 5");
    expect(nextBtn()).toBeDisabled();
    expect(prevBtn()).toBeEnabled();
  });

  it("N5-04: crossing a page boundary advances the list, then opens the adjacent row when data lands", async () => {
    const user = userEvent.setup();
    render(<Harness start="LD-B" />);
    await user.click(nextBtn());

    // The list has been asked for page 2; nothing has moved yet.
    expect(screen.getByTestId("requested").textContent).toBe("2");
    expect(openRef()).toBe("LD-B");
    // No double-fire while the neighbor page is in flight.
    expect(nextBtn()).toBeDisabled();
    expect(prevBtn()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);

    land(2);
    expect(openRef()).toBe("LD-C");
    expect(figure()).toContain("3 of 5");
    expect(nextBtn()).toBeEnabled();
  });

  it("N5-04: crossing BACKWARD opens the last row of the previous page", async () => {
    const user = userEvent.setup();
    render(<Harness start="LD-C" data0={pageOf(2)} />);
    expect(figure()).toContain("3 of 5");

    await user.click(prevBtn());
    expect(screen.getByTestId("requested").textContent).toBe("1");
    land(1);
    expect(openRef()).toBe("LD-B");
    expect(figure()).toContain("2 of 5");
  });

  it("N5-04: a failed neighbor fetch releases the arrows instead of holding them forever", async () => {
    const user = userEvent.setup();
    render(<Harness start="LD-B" />);
    await user.click(nextBtn());
    expect(nextBtn()).toBeDisabled();

    fail();
    expect(openRef()).toBe("LD-B");
    expect(nextBtn()).toBeEnabled();
  });
});

describe("N5-05: the pager only speaks for leads inside the working set", () => {
  it("N5-05: a deep-linked lead outside the current filters gets NO pager", () => {
    render(<Harness start="LD-OUTSIDE" />);
    expect(screen.getByTestId("no-pager")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next lead" })).toBeNull();
  });

  it("N5-05: no list data yet means no pager", () => {
    render(<Harness start="LD-A" data0={null} />);
    expect(screen.getByTestId("no-pager")).toBeInTheDocument();
  });

  it("N5-05/N5-30: the arrows name their action and the figure is tabular", () => {
    render(<Harness start="LD-B" />);
    expect(prevBtn()).toHaveAccessibleName("Previous lead");
    expect(nextBtn()).toHaveAccessibleName("Next lead");
    const fig = screen.getByText(/2 of 5/);
    expect(fig.className).toContain("tabular-nums");
    expect(fig.className).toContain("num");
  });
});
