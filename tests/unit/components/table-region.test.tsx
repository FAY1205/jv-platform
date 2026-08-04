// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/Table";

// D2 (SC 2.1.1): the Table scroll container must be keyboard-operable — wide tables
// overflow horizontally, and browsers don't auto-focus scrollers that contain focusable
// children (sortable Th buttons). tabIndex + role="region" + an accessible name is the
// canonical pattern; the global :focus-visible outline supplies the visible state.
describe("DSN-07: Table scroll region keyboard access", () => {
  function renderTable(ariaLabel?: string) {
    return render(
      <Table ariaLabel={ariaLabel}>
        <THead>
          <Tr>
            <Th sortable sortDir={null} onSort={() => {}}>Ref</Th>
          </Tr>
        </THead>
        <TBody>
          <Tr>
            <Td>LD-26-0001</Td>
          </Tr>
        </TBody>
      </Table>,
    );
  }

  it("D2/SC 2.1.1: the scroll container is a focusable named region", () => {
    renderTable();
    const region = screen.getByRole("region", { name: "Table" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.querySelector("table")).toBeTruthy();
  });

  it("D2: ariaLabel names the region for pages with several tables", () => {
    renderTable("Partner performance");
    expect(screen.getByRole("region", { name: "Partner performance" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Table" })).toBeNull();
  });

  it("D2/SC 1.3.1: a caller's aria-labelledby names the region too — never shadowed by the generic default (mls-phrases pattern)", () => {
    render(
      <>
        <h3 id="grp-keep">Keep override</h3>
        <Table aria-labelledby="grp-keep">
          <TBody>
            <Tr>
              <Td>row</Td>
            </Tr>
          </TBody>
        </Table>
      </>,
    );
    expect(screen.getByRole("region", { name: "Keep override" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Table" })).toBeNull();
    expect(screen.getByRole("table", { name: "Keep override" })).toBeTruthy();
  });
});
