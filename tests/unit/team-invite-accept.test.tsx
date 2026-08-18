// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Phase C: /team-invite/[token] — the PUBLIC accept page. Pre-session, so the POST is plain
// JSON (Origin-only CSRF, the login precedent) and every branch of the accept envelope has to
// land somewhere a stranger can act on: a dead link is terminal, an already-accepted invite
// points at sign-in, and a weak password stays inline on the field.

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

import { AcceptInviteForm } from "@/app/team-invite/[token]/accept-form";

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, pw = "correct-horse-battery") {
  await user.type(screen.getByLabelText("Create a password"), pw);
  await user.type(screen.getByLabelText("Confirm password"), pw);
  await user.click(screen.getByRole("button", { name: "Join the workspace" }));
}

describe("team invite accept page", () => {
  it("keeps the framing generic — it never names a workspace or the invitee", () => {
    render(<AcceptInviteForm token="tok-123" />);
    expect(screen.getByText("Accept your invite — set a password to join.")).toBeInTheDocument();
    expect(screen.getByText(/At least 12 characters/)).toBeInTheDocument();
  });

  it("flags a confirm mismatch at the field and refuses to submit", async () => {
    const user = userEvent.setup();
    render(<AcceptInviteForm token="tok-123" />);
    await user.type(screen.getByLabelText("Create a password"), "correct-horse-battery");
    await user.type(screen.getByLabelText("Confirm password"), "correct-horse-batteryX");

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join the workspace" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the token + password and lands the new seat on the dashboard", async () => {
    reply(200, { code: "accepted", message: "Welcome aboard." });
    const user = userEvent.setup();
    render(<AcceptInviteForm token="tok-123" />);
    await fillAndSubmit(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/team-invite/accept");
    expect(JSON.parse(String(init.body))).toEqual({ token: "tok-123", password: "correct-horse-battery" });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("a dead link is terminal: the form is replaced by an ask-your-admin message", async () => {
    reply(400, { code: "invite_invalid", message: "This invite link is invalid or has expired." });
    const user = userEvent.setup();
    render(<AcceptInviteForm token="tok-123" />);
    await fillAndSubmit(user);

    expect(
      await screen.findByText("This invite link is invalid or has expired. Ask your admin to send a new one."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join the workspace" })).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("renders the same terminal message when the URL carries no token at all", () => {
    render(<AcceptInviteForm token="" />);
    expect(
      screen.getByText("This invite link is invalid or has expired. Ask your admin to send a new one."),
    ).toBeInTheDocument();
  });

  it("an already-accepted invite points at sign-in instead of the form", async () => {
    reply(200, { code: "invite_already_accepted", message: "This invite was already accepted. You can sign in." });
    const user = userEvent.setup();
    render(<AcceptInviteForm token="tok-123" />);
    await fillAndSubmit(user);

    expect(await screen.findByText("This invite was already accepted. You can sign in.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("a seat whose auto-login failed is told to sign in (not left on a dead form)", async () => {
    reply(200, { code: "accepted_login_required", message: "Your account is ready — please sign in." });
    const user = userEvent.setup();
    render(<AcceptInviteForm token="tok-123" />);
    await fillAndSubmit(user);

    expect(await screen.findByText("Your account is ready — please sign in.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("a weak password shows the server's reasons inline on the field", async () => {
    reply(422, { code: "weak_password", message: "This password has appeared in a breach. Choose another." });
    const user = userEvent.setup();
    render(<AcceptInviteForm token="tok-123" />);
    await fillAndSubmit(user);

    expect(
      await screen.findByText("This password has appeared in a breach. Choose another."),
    ).toBeInTheDocument();
    // Still editable — this is a retry, not a dead end.
    expect(screen.getByRole("button", { name: "Join the workspace" })).toBeInTheDocument();
  });

  it("an address that already has an account gets a sign-in link", async () => {
    reply(409, { code: "email_in_use", message: "That email already has an account. Sign in instead." });
    const user = userEvent.setup();
    render(<AcceptInviteForm token="tok-123" />);
    await fillAndSubmit(user);

    expect(await screen.findByText("That email already has an account. Sign in instead.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});
