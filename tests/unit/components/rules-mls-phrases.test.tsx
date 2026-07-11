// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MlsPhrasesCard, type MlsPhrase } from "@/app/rules/mls-phrases";

// Render-level guards for the guarantees MlsPhrasesCard documents in its header comment.
// The pure ordering helper is tested in mls-groups.test.ts; this covers the JSX layer.

const PATTERNS: MlsPhrase[] = [
  // Deliberately disqualify-first in the input, to prove the component re-orders it.
  { id: "d1", patternKey: "sold", type: "disqualify", regex: "/\\bsold\\b/i", flags: "i", label: "Sold listings", enabled: true },
  { id: "k1", patternKey: "keep", type: "keep_override", regex: "/\\bkeep\\b/i", flags: "i", label: "Owner asked to keep", enabled: false },
];

describe("MlsPhrasesCard", () => {
  it("MLS-02: renders the keep-override group before the disqualify group", () => {
    render(<MlsPhrasesCard patterns={PATTERNS} onToggle={() => {}} />);
    const keep = screen.getByText("Keep-override phrases");
    const disq = screen.getByText("Disqualify phrases");
    expect(keep.compareDocumentPosition(disq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("PRN-14: conveys each effect with badge text, not color alone", () => {
    render(<MlsPhrasesCard patterns={PATTERNS} onToggle={() => {}} />);
    expect(screen.getByText("Keeps lead")).toBeInTheDocument();
    expect(screen.getByText("Removes lead")).toBeInTheDocument();
  });

  it("WCAG 1.3.1: ties each phrase table to its effect header via aria-labelledby", () => {
    render(<MlsPhrasesCard patterns={PATTERNS} onToggle={() => {}} />);
    expect(screen.getByRole("table", { name: /Keep-override phrases/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Disqualify phrases/ })).toBeInTheDocument();
  });

  it("PRN-04: shows the regex read-only (no editable control)", () => {
    render(<MlsPhrasesCard patterns={PATTERNS} onToggle={() => {}} />);
    expect(screen.getByText("/\\bsold\\b/i")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("reports the phrase id + new value when a switch is toggled", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<MlsPhrasesCard patterns={PATTERNS} onToggle={onToggle} />);
    await user.click(screen.getByRole("switch", { name: "Sold listings" }));
    expect(onToggle).toHaveBeenCalledWith("d1", false);
  });

  it("shows an empty state when there are no phrases", () => {
    render(<MlsPhrasesCard patterns={[]} onToggle={() => {}} />);
    expect(screen.getByText("No MLS phrases")).toBeInTheDocument();
  });
});
