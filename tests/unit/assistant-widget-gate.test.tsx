// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Deliberately do NOT mock @ai-sdk/react here: this test exercises the REAL useChat +
// DefaultChatTransport so the untested seam — gateFetch → gateStateFromCode → gate band +
// disabled composer, plus prepareSendMessagesRequest — runs end to end. The chat POST is
// intercepted at the global fetch boundary with a non-ok gate envelope.
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import AssistantWidget from "@/components/assistant/AssistantWidget";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
/** chat.ts:41-43 — no provider credential stored (first run). */
function noKeyResponse() {
  return jsonResponse(503, { code: "ai_disabled", message: "Add your AI provider API key in Settings → AI assistant to use the assistant.", traceId: "t1" });
}
/** chat.ts:50-52 — the assistant switch is off in Settings. */
function switchedOffResponse() {
  return jsonResponse(403, { code: "ai_disabled", message: "The assistant is switched off in Settings → AI assistant.", traceId: "t1" });
}
/** The per-tenant chat rate limit — a PASSING condition, unlike the two above. */
function rateLimitedResponse() {
  return jsonResponse(429, { code: "ai_rate_limited", message: "Too many questions — try again shortly.", traceId: "t4" });
}

async function ask() {
  render(<AssistantWidget />);
  await userEvent.click(screen.getByRole("button", { name: /open assistant/i }));
  await userEvent.type(screen.getByRole("textbox", { name: /ask the assistant/i }), "how many leads this month?");
  await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
}

async function expectComposerBlocked() {
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: /ask the assistant/i }) as HTMLInputElement).disabled).toBe(true),
  );
  expect((screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement).disabled).toBe(true);
}

// The single `ai_disabled` code carries two server truths, separable only by the HTTP status —
// this file proves the widget tells them apart (WP-AI-STYLE §4). The former ai_budget_reached
// case this suite used to fabricate is gone: the monthly cap was removed (ADR-0036) and the
// server never emits that code.
describe("WP-AI-2 AssistantWidget — ai_disabled gate wiring (real transport)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => noKeyResponse()));
    window.sessionStorage.clear(); // WP-AI-PERSIST: isolate the per-session open/transcript mirror
  });
  afterEach(() => vi.unstubAllGlobals());

  it("AIS-08: a 503 {code:ai_disabled} shows the missing-key band and disables the composer (no $)", async () => {
    await ask();

    const band = await screen.findByText(/needs a provider api key/i);
    expect(band).toBeTruthy();
    // Never a dollar figure in a gate band — spend lives in the tenant's provider dashboard.
    expect(band.textContent).not.toMatch(/\$/);
    // A tenant that never added a key was not "switched off" — that copy would be a lie.
    expect(screen.queryByText(/switched off/i)).toBeNull();

    await expectComposerBlocked();
  });

  it("AIS-08: a 403 {code:ai_disabled} shows the switched-off band instead", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => switchedOffResponse()));
    await ask();

    const band = await screen.findByText(/switched off/i);
    expect(band).toBeTruthy();
    expect(screen.queryByText(/needs a provider api key/i)).toBeNull();

    await expectComposerBlocked();
  });

  it("AIS-08: the retired monthly cap code (ADR-0036) is no longer a gate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(402, { code: "ai_budget_reached", message: "cap", traceId: "t3" })));
    await ask();

    // It falls through to the transient-error band, and the composer stays usable.
    await screen.findByText(/something went wrong reaching the assistant/i);
    expect(screen.queryByText(/ai allowance/i)).toBeNull();
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: /ask the assistant/i }) as HTMLInputElement).disabled).toBe(false),
    );
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

// C-45c: `rate` is the only gate that describes a condition which passes on its own — the
// band literally says "give it a minute". Before this, only "New chat" cleared it, so a user
// who hit the limit stared at a dead composer with a live transcript.
describe("C-45c AssistantWidget — rate gate self-clears (AIS-12)", () => {
  // shouldAdvanceTime keeps RTL/user-event's own async plumbing alive under fake timers.
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function askWithFakeTimers() {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AssistantWidget />);
    await user.click(screen.getByRole("button", { name: /open assistant/i }));
    await user.type(screen.getByRole("textbox", { name: /ask the assistant/i }), "how many leads this month?");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
  }
  const composer = () => screen.getByRole("textbox", { name: /ask the assistant/i }) as HTMLInputElement;
  const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it("AIS-12: a 429 blocks the composer, then clears itself after 60s and re-enables it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rateLimitedResponse()));
    await askWithFakeTimers();

    await waitFor(() => expect(screen.queryByText(/give it a minute/i)).toBeTruthy());
    await waitFor(() => expect(composer().disabled).toBe(true));

    // Still blocked just short of the window — the clear is a timer, not a re-render artifact.
    await advance(59_000);
    expect(composer().disabled).toBe(true);
    expect(screen.queryByText(/give it a minute/i)).toBeTruthy();

    await advance(1_500);
    await waitFor(() => expect(composer().disabled).toBe(false));
    expect(screen.queryByText(/give it a minute/i)).toBeNull();
  });

  it("AIS-12: no_key is configuration, not a passing condition — it never auto-clears", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => noKeyResponse()));
    await askWithFakeTimers();

    await waitFor(() => expect(screen.queryByText(/needs a provider api key/i)).toBeTruthy());
    await advance(5 * 60_000);
    expect(screen.queryByText(/needs a provider api key/i)).toBeTruthy();
    expect(composer().disabled).toBe(true);
  });

  it("AIS-12: the switched-off gate never auto-clears either", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => switchedOffResponse()));
    await askWithFakeTimers();

    await waitFor(() => expect(screen.queryByText(/switched off/i)).toBeTruthy());
    await advance(5 * 60_000);
    expect(screen.queryByText(/switched off/i)).toBeTruthy();
    expect(composer().disabled).toBe(true);
  });
});
