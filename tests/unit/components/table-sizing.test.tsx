// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

// WP-UX-1 — the Table column-sizing vocabulary (audit theme T1: fixed tracks
// wrapped starved columns while others hoarded dead gutters). `fit` = content
// width, never wraps; `clamp` = absorbs leftover width, ellipsizes with the full
// value on hover. PartnerTag's name span is the shrinkable part so ancestor
// clamps produce a real ellipsis instead of a hard mid-word cut (the Coverage
// panel finding).

import { Table, THead, TBody, Th, Tr, Td } from "@/components/Table";
import { PartnerTag } from "@/components/PartnerTag";

describe("Table sizing vocabulary (WP-UX-1)", () => {
  it("UX1-01: a `fit` header takes content width (w-px) and stays nowrap", () => {
    render(
      <Table>
        <THead>
          <Tr>
            <Th fit>Received</Th>
          </Tr>
        </THead>
        <TBody>
          <Tr>
            <Td>x</Td>
          </Tr>
        </TBody>
      </Table>,
    );
    const th = screen.getByRole("columnheader", { name: "Received" });
    expect(th.className).toContain("w-px");
    expect(th.className).toContain("whitespace-nowrap");
  });

  it("UX1-02: a `fit` cell never wraps its content", () => {
    render(
      <Table>
        <TBody>
          <Tr>
            <Td fit data-testid="date-cell">
              Aug 13, 2026
            </Td>
          </Tr>
        </TBody>
      </Table>,
    );
    const td = screen.getByTestId("date-cell");
    expect(td.className).toContain("w-px");
    expect(td.className).toContain("whitespace-nowrap");
  });

  it("UX1-03: a `clamp` cell ellipsizes via an inner truncate block and carries the full value as title", () => {
    render(
      <Table>
        <TBody>
          <Tr>
            <Td clamp clampTitle="Robert Thompson" data-testid="seller-cell">
              <span>Robert Thompson</span>
            </Td>
          </Tr>
        </TBody>
      </Table>,
    );
    const td = screen.getByTestId("seller-cell");
    // max-w-0 is what lets the column absorb leftover width instead of pushing the table wide.
    expect(td.className).toContain("max-w-0");
    const inner = td.querySelector("div.truncate");
    expect(inner).not.toBeNull();
    expect(inner!.getAttribute("title")).toBe("Robert Thompson");
  });

  it("UX1-03b: a plain cell renders children directly (no truncate wrapper) — clamp is opt-in", () => {
    render(
      <Table>
        <TBody>
          <Tr>
            <Td data-testid="plain-cell">
              <span>chips</span>
            </Td>
          </Tr>
        </TBody>
      </Table>,
    );
    expect(screen.getByTestId("plain-cell").querySelector("div.truncate")).toBeNull();
  });
});

describe("PartnerTag truncation (WP-UX-1)", () => {
  it("UX1-04: the NAME span is the shrinkable, truncating part; swatch and refId never shrink", () => {
    render(<PartnerTag name="Rocky Mountain Fixers" color="#8fbfe8" refId="PR-012" />);
    const name = screen.getByText("Rocky Mountain Fixers");
    expect(name.className).toContain("min-w-0");
    expect(name.className).toContain("truncate");
    const ref = screen.getByText("PR-012");
    expect(ref.className).toContain("shrink-0");
  });

  it("UX1-05: the outer tag is capped at its container (max-w-full) so a clamped cell can constrain it", () => {
    const { container } = render(<PartnerTag name="Cascade Property Group" color="#8fbfe8" refId="PR-011" />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("max-w-full");
    // PRN-14: name + reference ID both still render alongside the swatch.
    expect(screen.getByText("Cascade Property Group")).toBeTruthy();
    expect(screen.getByText("PR-011")).toBeTruthy();
  });
});
