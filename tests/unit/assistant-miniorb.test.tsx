// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MiniOrb } from "@/components/assistant/MiniOrb";

describe("WP-AI-2 MiniOrb", () => {
  it("renders a decorative, sized disc (no WebGL) for the header slot", () => {
    const { container } = render(<MiniOrb size={30} className="shrink-0" />);
    const el = container.querySelector(".assistant-miniorb") as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el!.getAttribute("aria-hidden")).toBe("true");
    expect(el!.style.width).toBe("30px");
    expect(el!.style.height).toBe("30px");
    expect(el!.className).toContain("shrink-0");
  });
});
