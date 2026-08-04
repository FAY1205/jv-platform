// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantMessage } from "@/components/assistant/AssistantMessage";

describe("WP-AI-2 AssistantMessage", () => {
  it("AIA-03: renders bullets and mono ref spans from the answer text", () => {
    render(<AssistantMessage id="m1" text={"Top partner:\n- PR-003 got 88 leads"} sources={[]} />);
    expect(screen.getByText("PR-003")).toBeTruthy();
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
    // but the source label still shows as a plain "From:" chip
    expect(screen.getByText(/from: evil/i)).toBeTruthy();
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
    // WP-AI-STYLE: the link pill reads "Open <label> →"; chips read "From: <label>".
    expect(screen.getByRole("link", { name: /open partner performance/i })).toBeTruthy();
    expect(screen.getByText(/from: region notes/i)).toBeTruthy();
  });
  it("WP-AI-STYLE: a reply with no text but a link is never blank — shows a fallback sentence", () => {
    render(<AssistantMessage id="m6" text="" sources={[{ label: "Coverage map", path: "/coverage" }]} />);
    expect(screen.getByText(/here's your coverage map/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /open coverage map/i })).toBeTruthy();
  });
  it("WP-AI-STYLE: shows a checking state while a tool runs (pending, no text yet)", () => {
    render(<AssistantMessage id="m7" text="" sources={[]} pending />);
    expect(screen.getByText(/checking your workspace/i)).toBeTruthy();
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
  it("renders the confirmed rated state when seeded with defaultRating (showcase)", () => {
    render(<AssistantMessage id="r" text="ok" sources={[]} defaultRating="up" />);
    expect(screen.getByText(/feedback recorded/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /helpful/i }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: /helpful/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
