// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestionChips } from "@/components/assistant/SuggestionChips";

describe("WP-AI-2 SuggestionChips", () => {
  it("renders one button per item under a labelled group", () => {
    render(<SuggestionChips items={["How are my partners performing?", "Which states have no coverage?"]} onSelect={() => {}} />);
    expect(screen.getByRole("group", { name: /suggested questions/i })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
  it("DSN-03: calls onSelect with the question text on click", async () => {
    const onSelect = vi.fn();
    render(<SuggestionChips items={["Explain this screen"]} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Explain this screen" }));
    expect(onSelect).toHaveBeenCalledWith("Explain this screen");
  });
  it("DSN-03: disables every chip when disabled", () => {
    render(<SuggestionChips items={["A", "B"]} onSelect={() => {}} disabled />);
    for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});
