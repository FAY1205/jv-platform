// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/EmptyState";

describe("DSN-06: EmptyState", () => {
  it("ES-01: compact renders a role=status with the title and no icon circle", () => {
    const { container } = render(
      <EmptyState compact icon={<svg data-testid="icon" />} title="Territory map unavailable." />,
    );
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Territory map unavailable.")).toBeTruthy();
    // Compact drops the icon slot entirely.
    expect(container.querySelector('[data-testid="icon"]')).toBeNull();
  });

  it("ES-02: compact shows an optional description", () => {
    render(<EmptyState compact title="Unavailable" description="Try again shortly." />);
    expect(screen.getByText("Try again shortly.")).toBeTruthy();
  });

  it("ES-03: the default (non-compact) layout still renders the icon and action", () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="No leads yet"
        action={<button>Add</button>}
      />,
    );
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    // Default layout is not a status live-region.
    expect(screen.queryByRole("status")).toBeNull();
  });
});
