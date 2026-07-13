// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantMessage } from "@/components/assistant/AssistantMessage";

describe("WP-AI-2 AssistantMessage", () => {
  it("AIA-03: renders bullets and mono ref spans from the answer text", () => {
    render(<AssistantMessage id="m1" text={"Top partner:\n- JV-003 got 88 leads"} sources={[]} />);
    expect(screen.getByText("JV-003")).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
  });
  it("PRN-10: renders a deep link only for an internal path, not duplicated as a plain chip", () => {
    render(<AssistantMessage id="m2" text="ok" sources={[{ label: "Coverage map", path: "/coverage" }]} />);
    const link = screen.getByRole("link", { name: /coverage map/i });
    expect(link.getAttribute("href")).toBe("/coverage");
    // the linked source must not also render as a separate plain chip
    expect(screen.getAllByText(/coverage map/i)).toHaveLength(1);
  });
  it("PRN-10: never renders a link for a non-internal path", () => {
    render(<AssistantMessage id="m3" text="ok" sources={[{ label: "Evil", path: "https://evil.example/x" }]} />);
    expect(screen.queryByRole("link")).toBeNull();
    // but the source label still shows as a plain chip
    expect(screen.getByText("Evil")).toBeTruthy();
  });
  it("renders extra sources as plain chips alongside the single linked source", () => {
    render(
      <AssistantMessage
        id="m5"
        text="ok"
        sources={[
          { label: "Partner performance", path: "/partners/x" },
          { label: "Region notes" },
        ]}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /partner performance/i })).toBeTruthy();
    expect(screen.getByText("Region notes")).toBeTruthy();
  });
  it("AIA-04/DSN-03: thumbs fire onFeedback and confirm", async () => {
    const onFeedback = vi.fn();
    render(<AssistantMessage id="m4" text="ok" sources={[]} showThumbs onFeedback={onFeedback} />);
    await userEvent.click(screen.getByRole("button", { name: /helpful/i }));
    expect(onFeedback).toHaveBeenCalledWith("m4", "up");
    expect(screen.getByText(/feedback recorded/i)).toBeTruthy();
  });
  it("omits thumbs for the welcome message", () => {
    render(<AssistantMessage id="w" text="Hi" sources={[]} showThumbs={false} />);
    expect(screen.queryByRole("button", { name: /helpful/i })).toBeNull();
  });
});
