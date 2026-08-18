"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, Input } from "@/components";
import { APP_NAME } from "@/lib/app";

// Accept a staff invite: set a password, become a seat, land signed in. Pre-session, so the
// POST carries no CSRF token — the endpoint is Origin-only by design (the login precedent).
// The token is the secret; nothing here reveals whether it is live until it is submitted.

const MIN_LEN = 12;

/** Client-side guidance only — src/lib/auth/password.ts is authoritative (AUT-02). */
function localHint(pw: string): string {
  if (!pw) return `At least ${MIN_LEN} characters`;
  if (pw.length < MIN_LEN) return `At least ${MIN_LEN} characters`;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  return variety < 2
    ? "Add more variety (letters, numbers, symbols)"
    : "Looks reasonable — the server does the final check";
}

type Outcome =
  /** The link itself is dead: a full-page terminal message, no form. */
  | { kind: "dead" }
  /** The seat exists; the invitee just needs to sign in. */
  | { kind: "sign-in"; message: string }
  /** The address already has an account (any workspace). */
  | { kind: "email-in-use"; message: string };

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [loading, setLoading] = React.useState(false);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch || password.length === 0 || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/team-invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      if (res.ok) {
        if (body?.code === "accepted") {
          router.push("/dashboard");
          router.refresh();
          return;
        }
        // "accepted_login_required" / "invite_already_accepted": the seat is real, the session
        // isn't — say so on the page and hand them the sign-in link.
        setOutcome({ kind: "sign-in", message: body?.message ?? "Your account is ready — please sign in." });
        return;
      }
      if (body?.code === "invite_invalid") {
        setOutcome({ kind: "dead" });
        return;
      }
      if (body?.code === "email_in_use") {
        setOutcome({ kind: "email-in-use", message: body.message ?? "That email already has an account." });
        return;
      }
      // 422 weak_password (message = the reasons) and everything else stay inline on the field.
      setError(body?.message ?? "Could not accept the invite.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardBody>
          <div className="mb-6 flex flex-col gap-1">
            <span className="font-display text-lg font-semibold text-text">{APP_NAME}</span>
            <span className="text-sm text-text-3">Accept your invite — set a password to join.</span>
          </div>

          {outcome?.kind === "dead" || !token ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="text-sm text-danger">
                This invite link is invalid or has expired. Ask your admin to send a new one.
              </p>
              <Link href="/login" className="text-sm font-semibold text-brand-ink hover:underline">
                Go to sign in
              </Link>
            </div>
          ) : outcome ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="text-sm text-text-2">
                {outcome.message}
              </p>
              <Link href="/login" className="text-sm font-semibold text-brand-ink hover:underline">
                Sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <Input
                label="Create a password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint={error ? undefined : localHint(password)}
                error={error ?? undefined}
              />
              <Input
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                error={mismatch ? "Passwords do not match." : undefined}
              />
              <Button
                type="submit"
                variant="primary"
                loading={loading}
                disabled={mismatch || password.length === 0}
                className="mt-1 w-full"
              >
                Join the workspace
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
