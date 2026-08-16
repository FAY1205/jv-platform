// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

// WP-UX-2 — the shared page-width vocabulary (audit theme T2: every page picked
// its own width and anchor, so adjacent nav items had different right edges and
// forms floated in an empty canvas). One centered container, four earned sizes.

import { PageContainer } from "@/components/PageContainer";

function classesOf(ui: React.ReactElement): string {
  const { container } = render(ui);
  return (container.firstElementChild as HTMLElement).className;
}

describe("PageContainer (WP-UX-2)", () => {
  it("UX2-01: every size centers (mx-auto w-full min-w-0)", () => {
    for (const size of ["prose", "reading", "hub", "full"] as const) {
      const cls = classesOf(<PageContainer size={size}>x</PageContainer>);
      expect(cls).toContain("mx-auto");
      expect(cls).toContain("w-full");
      expect(cls).toContain("min-w-0");
    }
  });

  it("UX2-02: sizes map to the Tailwind max-w scale — prose 3xl, reading 4xl, hub 5xl, full uncapped", () => {
    expect(classesOf(<PageContainer size="prose">x</PageContainer>)).toContain("max-w-3xl");
    expect(classesOf(<PageContainer size="reading">x</PageContainer>)).toContain("max-w-4xl");
    expect(classesOf(<PageContainer size="hub">x</PageContainer>)).toContain("max-w-5xl");
    expect(classesOf(<PageContainer>x</PageContainer>)).not.toContain("max-w-");
  });

  it("UX2-03: className merges (page keeps its own vertical rhythm)", () => {
    const cls = classesOf(
      <PageContainer size="reading" className="flex flex-col gap-5">
        x
      </PageContainer>,
    );
    expect(cls).toContain("flex-col");
    expect(cls).toContain("max-w-4xl");
  });
});
