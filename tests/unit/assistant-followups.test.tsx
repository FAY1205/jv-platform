// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// C-45a / AIS-10: the post-answer follow-up row. Same mocked-transport shape as
// assistant-widget.test.tsx — this file drives the transcript/status directly, because the row
// is a pure function of (screen, transcript, idleness), not of anything the network does.
vi.mock("next/navigation", () => ({ usePathname: () => "/coverage" }));
const chat = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  state: { messages: [] as unknown[], status: "ready" as string, error: undefined as unknown },
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chat.state.messages,
    status: chat.state.status,
    error: chat.state.error,
    sendMessage: chat.sendMessage,
    setMessages: vi.fn(),
    clearError: vi.fn(),
    stop: vi.fn(),
    regenerate: vi.fn(),
  }),
  DefaultChatTransport: class { constructor(_: unknown) {} },
}));

import AssistantWidget from "@/components/assistant/AssistantWidget";

const userMsg = (id: string, text: string) => ({ id, role: "user", parts: [{ type: "text", text }] });
const answer = (id: string, text: string) => ({ id, role: "assistant", parts: [{ type: "text", text }] });

/** A finished turn: one question asked, one answer back. */
const ANSWERED = [userMsg("u1", "Who covers the most states?"), answer("a1", "**Meridian Buyers**, with 7 states.")];

async function openPanel() {
  render(<AssistantWidget />);
  await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
}
const followUpRow = () => screen.queryByRole("group", { name: /follow-up questions/i });

describe("C-45a AssistantWidget — follow-up chips (AIS-10)", () => {
  beforeEach(() => {
    chat.sendMessage.mockClear();
    window.sessionStorage.clear();
    chat.state.messages = [];
    chat.state.status = "ready";
    chat.state.error = undefined;
  });

  it("AIS-10: an idle transcript ending in an answer gets a bounded row of at most 3 chips", async () => {
    chat.state.messages = ANSWERED;
    await openPanel();
    const row = followUpRow()!;
    expect(row).toBeTruthy();
    const chips = within(row).getAllByRole("button");
    expect(chips.length).toBeLessThanOrEqual(3);
    // Headed as a next step, not as a fresh start ("Try asking" belongs to the empty state).
    expect(screen.getByText(/ask next/i)).toBeTruthy();
    // /coverage screen → the coverage set, minus the question already asked.
    expect(chips.map((b) => b.textContent)).not.toContain("Who covers the most states?");
    expect(within(row).getByRole("button", { name: /which states have no coverage/i })).toBeTruthy();
    expect(chips[chips.length - 1].textContent).toContain("Explain this screen");
  });

  it("AIS-10: a chip click goes through the existing send path", async () => {
    chat.state.messages = ANSWERED;
    await openPanel();
    await userEvent.click(within(followUpRow()!).getByRole("button", { name: /which states have no coverage/i }));
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "Which states have no coverage?" });
  });

  it("AIS-10: never mid-stream", async () => {
    chat.state.messages = ANSWERED;
    chat.state.status = "streaming";
    await openPanel();
    expect(followUpRow()).toBeNull();
  });

  it("AIS-10: never under the last message when that message is the user's own", async () => {
    chat.state.messages = [...ANSWERED, userMsg("u2", "and unmatched?")];
    await openPanel();
    expect(followUpRow()).toBeNull();
  });

  it("AIS-10: never on an empty transcript — the empty state owns its own chip set", async () => {
    await openPanel();
    expect(followUpRow()).toBeNull();
    expect(screen.getByRole("group", { name: /suggested questions/i })).toBeTruthy();
  });

  it("AIS-10: never alongside an error band", async () => {
    chat.state.messages = ANSWERED;
    chat.state.error = new Error("network");
    await openPanel();
    expect(screen.getByText(/something went wrong reaching the assistant/i)).toBeTruthy();
    expect(followUpRow()).toBeNull();
  });

  it("AIS-10: gone once the user starts composing", async () => {
    chat.state.messages = ANSWERED;
    await openPanel();
    expect(followUpRow()).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: /ask the assistant/i }), "h");
    expect(followUpRow()).toBeNull();
  });

  it("AIS-10: a chip the user already asked never comes back", async () => {
    chat.state.messages = [
      userMsg("u1", "which states have no coverage?"), // typed by hand, different case
      answer("a1", "**Three** states have none."),
    ];
    await openPanel();
    const row = followUpRow()!;
    for (const b of within(row).getAllByRole("button")) {
      expect(b.textContent?.toLowerCase()).not.toContain("which states have no coverage?");
    }
  });
});
