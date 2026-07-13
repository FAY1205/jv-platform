// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantIconButton } from "@/components/assistant/AssistantIconButton";

describe("WP-AI-2 AssistantIconButton", () => {
  it("SC 4.1.2: renders an icon-only button carrying its accessible name", () => {
    render(
      <AssistantIconButton aria-label="Close assistant" variant="ghost">
        <svg />
      </AssistantIconButton>,
    );
    expect(screen.getByRole("button", { name: "Close assistant" })).toBeTruthy();
  });

  it("DSN-03: sizes to the per-variant default (ghost 34 / toggle 26 / primary 36) — mockup rev-7 sub-44px", () => {
    const { rerender } = render(
      <AssistantIconButton aria-label="a" variant="ghost">
        <svg />
      </AssistantIconButton>,
    );
    expect(screen.getByRole("button").style.width).toBe("34px");
    expect(screen.getByRole("button").style.height).toBe("34px");
    rerender(
      <AssistantIconButton aria-label="a" variant="toggle">
        <svg />
      </AssistantIconButton>,
    );
    expect(screen.getByRole("button").style.width).toBe("26px");
    rerender(
      <AssistantIconButton aria-label="a" variant="primary">
        <svg />
      </AssistantIconButton>,
    );
    expect(screen.getByRole("button").style.height).toBe("36px");
  });

  it("DSN-03: honors an explicit size override", () => {
    render(
      <AssistantIconButton aria-label="a" variant="ghost" size={40}>
        <svg />
      </AssistantIconButton>,
    );
    const b = screen.getByRole("button");
    expect(b.style.width).toBe("40px");
    expect(b.style.height).toBe("40px");
  });

  it("DSN-03: applies the variant recipe (primary = brand fill; ghost/toggle = neutral chrome)", () => {
    const { rerender } = render(
      <AssistantIconButton aria-label="a" variant="primary">
        <svg />
      </AssistantIconButton>,
    );
    expect(screen.getByRole("button").className).toContain("bg-brand");
    rerender(
      <AssistantIconButton aria-label="a" variant="ghost">
        <svg />
      </AssistantIconButton>,
    );
    expect(screen.getByRole("button").className).toContain("text-text-3");
    expect(screen.getByRole("button").className).not.toContain("bg-brand");
  });

  it("DSN-03: exposes focus-visible + active + disabled affordances", () => {
    render(
      <AssistantIconButton aria-label="a" variant="ghost" disabled>
        <svg />
      </AssistantIconButton>,
    );
    const b = screen.getByRole("button") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.className).toMatch(/focus-visible:/);
    expect(b.className).toMatch(/active:scale-95/);
  });

  it("DSN-03: forwards click + aria-pressed for the toggle variant", async () => {
    const onClick = vi.fn();
    render(
      <AssistantIconButton aria-label="Helpful" variant="toggle" aria-pressed onClick={onClick}>
        <svg />
      </AssistantIconButton>,
    );
    const b = screen.getByRole("button", { name: "Helpful" });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("SC 4.1.2: defaults type to button so it never submits a surrounding form", () => {
    render(
      <AssistantIconButton aria-label="a" variant="ghost">
        <svg />
      </AssistantIconButton>,
    );
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("DSN-03: loading disables the button, marks aria-busy, and swaps the glyph for a spinner", () => {
    render(
      <AssistantIconButton aria-label="Send" variant="primary" loading>
        <svg data-testid="glyph" />
      </AssistantIconButton>,
    );
    const b = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("glyph")).toBeNull();
    expect(b.querySelector("svg")).not.toBeNull(); // the spinner
  });
});
