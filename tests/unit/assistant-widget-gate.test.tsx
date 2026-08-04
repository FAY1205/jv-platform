// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Deliberately do NOT mock @ai-sdk/react here: this test exercises the REAL useChat +
// DefaultChatTransport so the untested seam — gateFetch → gateStateFromCode → cap band +
// disabled composer, plus prepareSendMessagesRequest — runs end to end. The chat POST is
// intercepted at the global fetch boundary with a non-ok budget envelope.
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import AssistantWidget from "@/components/assistant/AssistantWidget";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function budgetResponse() {
  return jsonResponse(402, { code: "ai_budget_reached", message: "cap", traceId: "t1" });
}

describe("WP-AI-2 AssistantWidget — budget gate wiring (real transport)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => budgetResponse()));
    window.sessionStorage.clear(); // WP-AI-PERSIST: isolate the per-session open/transcript mirror
  });
  afterEach(() => vi.unstubAllGlobals());

  it("AIA-06: a non-ok {code:ai_budget_reached} chat response flips to the cap band and disables the composer (no $)", async () => {
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));

    const input = screen.getByRole("textbox", { name: /ask the assistant/i });
    await userEvent.type(input, "how many leads this month?");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // The cap band appears with allowance copy (never a dollar figure — $ lives in Settings).
    const band = await screen.findByText(/used this month.s ai allowance/i);
    expect(band).toBeTruthy();
    expect(band.textContent).not.toMatch(/\$/);

    // Composer is disabled while the gate is set.
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: /ask the assistant/i }) as HTMLInputElement).disabled).toBe(true),
    );
    expect((screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("AIA-07: an over-cap 400 {code:invalid_input} surfaces a recoverable error with a New chat escape, not a permanent block", async () => {
    // The server caps history at 24 messages (ChatBodySchema); over-cap returns invalid_input,
    // which is NOT a gate — it must stay recoverable (regenerate would just resend the same
    // over-length payload, so the band also offers "start a new chat").
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { code: "invalid_input", message: "too long", traceId: "t2" })));
    render(<AssistantWidget />);
    await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /ask the assistant/i }), "another question");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await screen.findByText(/something went wrong reaching the assistant/i);
    expect(screen.getByRole("button", { name: /start a new chat/i })).toBeTruthy();
    // invalid_input is not a gate → composer stays usable (not a permanent cap band).
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: /ask the assistant/i }) as HTMLInputElement).disabled).toBe(false),
    );
  });
});
