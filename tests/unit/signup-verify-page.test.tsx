// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("token=abc123token"),
}));

import VerifyPage from "@/app/signup/verify/page";

describe("SignupVerifyPage — confirm email via token link", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a Verify my email button when a token is present", () => {
    render(<VerifyPage />);
    expect(screen.getByRole("button", { name: /verify my email/i })).toBeTruthy();
  });

  it("clicking the button with a successful response shows the success state and a Sign in link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    render(<VerifyPage />);
    await userEvent.click(screen.getByRole("button", { name: /verify my email/i }));

    await screen.findByRole("link", { name: /sign in/i });
  });

  it("clicking the button with a failed response shows the server error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ message: "This link is invalid or has expired." }),
      })),
    );

    render(<VerifyPage />);
    await userEvent.click(screen.getByRole("button", { name: /verify my email/i }));

    await screen.findByText(/this link is invalid or has expired\./i);
  });
});
