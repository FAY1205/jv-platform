// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ usePathname: () => "/coverage" }));
// A mutable chat state so a case can drive the transcript/status the widget renders
// (an empty ready panel by default; a streaming or tool-answered transcript when asked).
const chat = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  state: { messages: [] as unknown[], status: "ready" as string },
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chat.state.messages,
    status: chat.state.status,
    error: undefined,
    sendMessage: chat.sendMessage,
    setMessages: vi.fn(),
    clearError: vi.fn(),
    stop: vi.fn(),
    regenerate: vi.fn(),
  }),
  DefaultChatTransport: class { constructor(_: unknown) {} },
}));

import AssistantWidget from "@/components/assistant/AssistantWidget";
import { THINKING_COPY } from "@/components/assistant/AssistantMessage";

const sendMessage = chat.sendMessage;

describe("WP-AI-2 AssistantWidget", () => {
  // WP-AI-PERSIST: the widget mirrors open/transcript to sessionStorage, which the jsdom
  // env shares across tests — clear it so each case starts from a closed, empty panel.
  beforeEach(() => {
    sendMessage.mockClear();
    window.sessionStorage.clear();
    chat.state.messages = [];
    chat.state.status = "ready";
  });

  it("renders the launcher collapsed by default", () => {
    render(<AssistantWidget />);
    expect(screen.getByRole("button", { name: /open assistant/i })).toBeTruthy();
  });

  it("opens the panel and shows the welcome + contextual chips for the current screen", async () => {
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
    expect(screen.getByRole("group", { name: /suggested questions/i })).toBeTruthy();
    // /coverage screen → coverage suggestions (from suggestionsFor)
    expect(screen.getByRole("button", { name: /which states have no coverage/i })).toBeTruthy();
  });

  it("sends a chip's question via sendMessage", async () => {
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
    await userEvent.click(screen.getByRole("button", { name: /which states have no coverage/i }));
    expect(sendMessage).toHaveBeenCalledWith({ text: "Which states have no coverage?" });
  });

  it("AIS-05: sourcesOf forwards a tool result's notFound flag, so the reply says 'no match'", async () => {
    chat.state.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "how is Meridian West doing?" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "tool-get_partner_performance", state: "output-available", toolCallId: "c1", input: {}, output: { source: "Partner roster", notFound: "Meridian West" } }],
      },
    ];
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
    expect(screen.getByText(/No match for that reference in Partner roster/)).toBeInTheDocument();
    expect(screen.queryByText(/here's what i found/i)).toBeNull();
  });

  it("AIS-06: the thinking row uses the shared THINKING_COPY string, with no literal ellipsis", async () => {
    chat.state.messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "how many leads this week?" }] }];
    chat.state.status = "streaming";
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
    const row = screen.getByRole("status", { name: /assistant is thinking/i });
    const line = within(row).getByText(THINKING_COPY);
    expect(line.textContent).toBe(THINKING_COPY);
    // The animated dots ARE the ellipsis — a literal one would double-punctuate.
    expect(row.textContent).not.toMatch(/…|\.\.\./);
  });
});
