// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Orb } from "@/components/assistant/Orb";

describe("WP-AI-2 Orb", () => {
  it("renders a decorative canvas at the requested CSS size without throwing (jsdom: null 2d ctx)", () => {
    const { container } = render(<Orb size={34} animate />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.style.width).toBe("34px");
    expect(canvas!.style.height).toBe("34px");
    // wrapper is decorative
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("renders a static orb (animate omitted) without throwing", () => {
    const { container } = render(<Orb size={24} />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
