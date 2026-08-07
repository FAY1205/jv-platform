// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/Toast";

afterEach(() => vi.useRealTimers());

function Harness() {
  const { toast } = useToast();
  return <button onClick={() => toast("Saved")}>fire</button>;
}

function setup() {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText("fire"));
}

// UXQ-09 / WCAG 2.2.1 (Timing Adjustable): an auto-dismissing toast must let the user
// keep it around long enough to read/act — pause on hover and on keyboard focus, and be
// dismissible on demand.
describe("UXQ-09 / WCAG 2.2.1: Toast auto-dismiss", () => {
  it("TOAST-01: auto-dismisses after its duration when left alone", () => {
    vi.useFakeTimers();
    setup();
    // Scope to the visible stack: the message also lives in the sr-only announcer (R-56).
    expect(within(screen.getByTestId("toast-stack")).getByText("Saved")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("TOAST-02: pauses the countdown while the stack is hovered, resumes on mouse-leave", () => {
    vi.useFakeTimers();
    setup();
    // The hover-pause lives on the visible stack (R-56 split the live region off from it).
    const region = screen.getByTestId("toast-stack");
    fireEvent.mouseEnter(region);
    act(() => vi.advanceTimersByTime(10000)); // well past the duration
    expect(within(region).queryByText("Saved")).toBeTruthy(); // still present — paused
    fireEvent.mouseLeave(region);
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.queryByText("Saved")).toBeNull(); // dismissed after resume
  });

  it("TOAST-03: pauses while a toast control is focused, resumes on blur", () => {
    vi.useFakeTimers();
    setup();
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.focusIn(dismiss);
    act(() => vi.advanceTimersByTime(10000));
    expect(within(screen.getByTestId("toast-stack")).queryByText("Saved")).toBeTruthy();
    fireEvent.focusOut(dismiss);
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("TOAST-04: the dismiss control removes the toast immediately", () => {
    vi.useFakeTimers();
    setup();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("R-56/WCAG-4.1.3: the polite live region announces the message text but holds no controls — the dismiss ✕ isn't read out with it", () => {
    setup();
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("Saved");
    // The dismiss ✕ lives in the visible stack, NOT the announced region, so a screen reader does
    // not append "Dismiss notification" to every toast. (Before R-56 the live region wrapped the row,
    // so this button WAS inside it.)
    expect(within(live).queryByRole("button")).toBeNull();
    // …but it is still present and operable in the visible stack.
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });
});
