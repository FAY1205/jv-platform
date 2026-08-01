// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SignupPage from "@/app/signup/page";

// jsdom has no ResizeObserver. The new ToS Checkbox sits inside a <form>, so
// Radix's checkbox renders a hidden "bubble input" (for native form submission)
// that sizes itself via ResizeObserver — harmless in real browsers (which all
// implement it), but throws in jsdom. Stub it so mount doesn't crash.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

describe("SignupPage — public signup with Turnstile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  it("renders email, password, and workspace-name inputs and a submit button", () => {
    render(<SignupPage />);
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByLabelText(/workspace/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign up|create/i })).toBeTruthy();
  });

  it("disables the submit button before a CAPTCHA token exists (no window.turnstile in jsdom)", () => {
    render(<SignupPage />);
    const submit = screen.getByRole("button", { name: /sign up|create/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("renders a ToS/Privacy consent checkbox and keeps submit disabled until it is checked", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    (window as unknown as { turnstile: { render: (el: HTMLElement, opts: Record<string, unknown>) => void } }).turnstile = {
      render: (_el, opts) => {
        (opts.callback as (t: string) => void)("tok");
      },
    };

    render(<SignupPage />);
    const consent = screen.getByRole("checkbox", { name: /terms of service/i }) as HTMLInputElement;
    expect(consent).toBeTruthy();

    // SCP-03: an invitation code is also required to enable submit.
    await userEvent.type(screen.getByLabelText(/invitation code/i), "ABCD-EFGH-JKLM");

    const submit = await screen.findByRole("button", { name: /sign up|create/i });
    // CAPTCHA token + code present, but consent is not yet checked.
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(consent);
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("a successful submit shows the check-your-email state", async () => {
    // The site key is a public NEXT_PUBLIC_* var inlined at build; stub it here so the
    // component's render-guard (which requires a configured site key) proceeds.
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    // Simulate the Turnstile widget: assign window.turnstile BEFORE render so the
    // component's effect captures a token via the callback.
    (window as unknown as { turnstile: { render: (el: HTMLElement, opts: Record<string, unknown>) => void } }).turnstile = {
      render: (_el, opts) => {
        (opts.callback as (t: string) => void)("tok");
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })),
    );

    render(<SignupPage />);

    await userEvent.type(screen.getByLabelText(/email/i), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "a-strong-password-1!");
    await userEvent.type(screen.getByLabelText(/workspace/i), "Acme Realty");
    await userEvent.type(screen.getByLabelText(/invitation code/i), "ABCD-EFGH-JKLM");
    await userEvent.click(screen.getByRole("checkbox", { name: /terms of service/i }));

    const submit = await screen.findByRole("button", { name: /sign up|create/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(submit);

    await screen.findByText(/check your email to finish setting up your workspace/i);
  });
});
