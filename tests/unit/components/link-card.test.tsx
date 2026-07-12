// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { LinkCard } from "@/components/LinkCard";

describe("DSN-03: LinkCard", () => {
  it("LC-01: renders an anchor to href with the shared card chrome", () => {
    render(<LinkCard href="/portal/leads/abc">Lead abc</LinkCard>);
    const a = screen.getByRole("link", { name: "Lead abc" });
    expect(a.getAttribute("href")).toBe("/portal/leads/abc");
    expect(a.className).toContain("rounded-xl");
    expect(a.className).toContain("border-border");
    expect(a.className).toContain("hover:border-text-3");
    expect(a.className).toContain("focus-visible:border-brand-ink");
  });

  it("LC-02: merges a consumer className and owns no display utility in its base", () => {
    render(<LinkCard href="/x" className="flex flex-col p-4">row</LinkCard>);
    const a = screen.getByRole("link", { name: "row" });
    expect(a.className).toContain("flex");
    expect(a.className).toContain("p-4");
    // The base must not set display, so a caller's block/flex never conflicts.
    expect(a.className).not.toContain(" block ");
    expect(a.className.startsWith("block ")).toBe(false);
  });

  it("LC-03: forwards its ref to the underlying anchor", () => {
    const ref = React.createRef<HTMLAnchorElement>();
    render(<LinkCard href="/x" ref={ref}>y</LinkCard>);
    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
  });
});
