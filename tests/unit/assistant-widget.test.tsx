// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ usePathname: () => "/coverage" }));
const sendMessage = vi.fn();
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({ messages: [], status: "ready", error: undefined, sendMessage, setMessages: vi.fn(), clearError: vi.fn(), stop: vi.fn() }),
  DefaultChatTransport: class { constructor(_: unknown) {} },
}));

import AssistantWidget from "@/components/assistant/AssistantWidget";

describe("WP-AI-2 AssistantWidget", () => {
  beforeEach(() => sendMessage.mockClear());

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
});
