// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MlsPhrasesCard, type MlsPhrase } from "@/app/(admin)/rules/mls-phrases";

// Render-level guards for the guarantees MlsPhrasesCard documents in its header comment.
// The pure ordering helper is tested in mls-groups.test.ts; this covers the JSX layer.
// The card is READ-ONLY (2026-08-01): no toggle, no regex, no internal key on screen.

const PATTERNS: MlsPhrase[] = [
  // Deliberately disqualify-first in the input, to prove the component re-orders it.
  { id: "d1", patternKey: "sold", type: "disqualify", regex: "/\\bsold\\b/i", flags: "i", label: "Sold listings", enabled: true },
  { id: "k1", patternKey: "keep", type: "keep_override", regex: "/\\bkeep\\b/i", flags: "i", label: "Owner asked to keep", enabled: true },
];

describe("MlsPhrasesCard", () => {
  it("MLS-02: renders the keep-override group before the disqualify group", () => {
    render(<MlsPhrasesCard patterns={PATTERNS} />);
    const keep = screen.getByText("Keep-override phrases");
    const disq = screen.getByText("Disqualify phrases");
    expect(keep.compareDocumentPosition(disq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("PRN-14: conveys each effect with badge text, not color alone", () => {
    render(<MlsPhrasesCard patterns={PATTERNS} />);
    expect(screen.getByText("Keeps lead")).toBeInTheDocument();
    expect(screen.getByText("Removes lead")).toBeInTheDocument();
  });

  it("shows each phrase by its friendly label", () => {
    render(<MlsPhrasesCard patterns={PATTERNS} />);
    expect(screen.getByText("Sold listings")).toBeInTheDocument();
    expect(screen.getByText("Owner asked to keep")).toBeInTheDocument();
  });

  it("read-only: renders no toggle, no editable control, and never leaks the regex", () => {
    render(<MlsPhrasesCard patterns={PATTERNS} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("/\\bsold\\b/i")).toBeNull();
    expect(screen.queryByText("sold")).toBeNull(); // internal pattern key not shown
  });

  it("shows an empty state when there are no phrases", () => {
    render(<MlsPhrasesCard patterns={[]} />);
    expect(screen.getByText("No MLS phrases")).toBeInTheDocument();
  });
});
