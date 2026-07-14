import { describe, expect, it } from "vitest";
import { formatAnswer, type AnswerBlock } from "@/modules/ai/format-answer";

describe("WP-AI-2 formatAnswer", () => {
  it("returns a single paragraph for plain prose", () => {
    const b = formatAnswer("You have 7 active partners.");
    expect(b).toEqual<AnswerBlock[]>([{ type: "p", spans: [{ kind: "text", text: "You have 7 active partners." }] }]);
  });
  it("groups dash/•/* bullet lines into one list", () => {
    const b = formatAnswer("Top gaps:\n- California — 31 waiting\n– Arizona — 18 waiting\n* Nevada — 7 waiting");
    expect(b[0]).toEqual({ type: "p", spans: [{ kind: "text", text: "Top gaps:" }] });
    expect(b[1].type).toBe("ul");
    expect((b[1] as Extract<AnswerBlock, { type: "ul" }>).items).toHaveLength(3);
  });
  it("tokenizes **bold** spans", () => {
    const b = formatAnswer("**Meridian Buyers** is your top partner.");
    const p = b[0] as Extract<AnswerBlock, { type: "p" }>;
    expect(p.spans[0]).toEqual({ kind: "bold", text: "Meridian Buyers" });
    expect(p.spans[1]).toEqual({ kind: "text", text: " is your top partner." });
  });
  it("tokenizes ref IDs into mono spans", () => {
    const b = formatAnswer("Partner PR-003 and lead LD-26-00042 in import IM-26-004.");
    const kinds = (b[0] as Extract<AnswerBlock, { type: "p" }>).spans.filter((s) => s.kind === "ref").map((s) => s.text);
    expect(kinds).toEqual(["PR-003", "LD-26-00042", "IM-26-004"]);
  });
  it("does not treat a mid-word hyphen as a bullet", () => {
    const b = formatAnswer("first-pass match rate is 74%.");
    expect(b).toHaveLength(1);
    expect(b[0].type).toBe("p");
  });
  it("returns [] for empty/whitespace", () => {
    expect(formatAnswer("   ")).toEqual([]);
  });
});
