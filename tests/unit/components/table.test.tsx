// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Table, THead, TBody, Tr, Th, Td } from "@/components";

describe("Table Th (F-85)", () => {
  it("F-85: column headers render <th scope=\"col\"> for screen-reader association", () => {
    const { container } = render(
      <Table>
        <THead><Tr><Th>When</Th><Th>Who</Th></Tr></THead>
        <TBody><Tr><Td>a</Td><Td>b</Td></Tr></TBody>
      </Table>,
    );
    const ths = Array.from(container.querySelectorAll("th"));
    expect(ths).toHaveLength(2);
    expect(ths.every((th) => th.getAttribute("scope") === "col")).toBe(true);
  });

  it("F-85: a caller can still override scope via ...rest", () => {
    const { container } = render(
      <Table>
        <THead><Tr><Th scope="row">Row head</Th></Tr></THead>
      </Table>,
    );
    expect(container.querySelector("th")?.getAttribute("scope")).toBe("row");
  });
});
