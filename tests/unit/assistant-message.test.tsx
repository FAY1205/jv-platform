// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantMessage } from "@/components/assistant/AssistantMessage";

// AI redesign: assistant answers are FLAT annotations (no boxed chat bubble), each run led by
// a MiniOrb + "Assistant" marker. These lock the structure the live AI call couldn't exercise
// in the dev harness (no CSRF session).
describe("AssistantMessage — flat annotation + marker (AI redesign)", () => {
  it("firstOfRun shows the 'Assistant' marker above the answer, and renders the answer text", () => {
    render(<AssistantMessage id="a1" text="You have **13** active partners." sources={[]} showThumbs={false} />);
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText(/active partners/)).toBeInTheDocument();
  });

  it("firstOfRun={false} omits the marker (a consecutive answer in the same run)", () => {
    render(<AssistantMessage id="a2" text="And 21 unmatched." sources={[]} showThumbs={false} firstOfRun={false} />);
    expect(screen.queryByText("Assistant")).toBeNull();
    expect(screen.getByText(/unmatched/)).toBeInTheDocument();
  });

  it("is NOT a boxed bubble — no border/surface card wrapper around the answer", () => {
    const { container } = render(<AssistantMessage id="a3" text="Hello." sources={[]} showThumbs={false} />);
    const root = container.firstElementChild as HTMLElement;
    // The old design wrapped each reply in `border border-border-soft bg-surface shadow-xs`.
    expect(root.className).not.toContain("bg-surface");
    expect(root.className).not.toContain("border-border-soft");
  });

  it("a reply that returned only a link is never blank — it falls back to a sentence", () => {
    render(<AssistantMessage id="a4" text="" sources={[{ label: "Leads", path: "/leads" }]} showThumbs={false} />);
    expect(screen.getByText(/open it below/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Leads/i })).toBeInTheDocument();
  });
});
