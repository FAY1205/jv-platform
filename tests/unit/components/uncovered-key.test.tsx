// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

// WP-UX-4 (audit D-1) — the shared "Uncovered" map key and the neutralized hatch.
// The dashboard map previously had no legend while the hatch wore the brand's amber
// family, so uncovered states read as OWNED — the audit's one wrong-conclusion finding.

import { UncoveredKey } from "@/components/map";
import { MapHatch } from "@/components/map/MapHatch";

describe("Uncovered map key (WP-UX-4)", () => {
  it("UX4-03: the key names the state in words beside the swatch (PRN-14)", () => {
    render(<UncoveredKey />);
    expect(screen.getByText("Uncovered")).toBeTruthy();
    // The swatch renders the REAL hatch pattern, not an approximation — exact parity
    // with what the map draws.
    expect(document.querySelector("pattern")).not.toBeNull();
  });

  it("UX4-04: the hatch is NEUTRAL — no brand/warn-family fill that could read as a partner", () => {
    const { container } = render(
      <svg>
        <MapHatch id="t" />
      </svg>,
    );
    const html = container.innerHTML;
    expect(html).toContain("var(--surface-3)");
    expect(html).toContain("var(--border-strong)");
    expect(html).not.toContain("--warn");
    expect(html).not.toContain("--brand");
  });
});
