// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
    expect(screen.getByText("Saved")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("TOAST-02: pauses the countdown while the stack is hovered, resumes on mouse-leave", () => {
    vi.useFakeTimers();
    setup();
    const region = screen.getByRole("status");
    fireEvent.mouseEnter(region);
    act(() => vi.advanceTimersByTime(10000)); // well past the duration
    expect(screen.queryByText("Saved")).toBeTruthy(); // still present — paused
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
    expect(screen.queryByText("Saved")).toBeTruthy();
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
});
