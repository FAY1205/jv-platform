// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

const setMessages = vi.fn();
const clearError = vi.fn();
const stop = vi.fn();
// A non-empty transcript so the "New chat" affordance is present (it hides on an
// empty transcript — nothing to reset).
const messages = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "how many leads?" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "665 this month." }] },
];
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages,
    status: "ready",
    error: undefined,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    setMessages,
    clearError,
    stop,
  }),
  DefaultChatTransport: class {},
}));

import AssistantWidget from "@/components/assistant/AssistantWidget";

describe("WP-AI-2 AssistantWidget — New chat", () => {
  beforeEach(() => {
    setMessages.mockClear();
    clearError.mockClear();
    stop.mockClear();
    window.sessionStorage.clear(); // WP-AI-PERSIST: isolate the per-session open/transcript mirror
  });

  it("shows a New chat control once the transcript is non-empty", async () => {
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
    expect(screen.getByRole("button", { name: /new chat/i })).toBeTruthy();
  });

  it("resets the transcript, clears any error, and stops streaming on New chat", async () => {
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));
    expect(setMessages).toHaveBeenCalledWith([]);
    expect(clearError).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
