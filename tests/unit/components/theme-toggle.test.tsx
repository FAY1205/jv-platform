// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { setPreferences, DEFAULT_PREFERENCES } from "@/lib/preferences";

describe("DSN: ThemeToggle", () => {
  beforeEach(() => setPreferences(DEFAULT_PREFERENCES)); // theme: "system" → no data-theme attr

  it("DSN-TH-01: advances the theme preference on click", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: /theme/i });
    fireEvent.click(btn); // system → light
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
