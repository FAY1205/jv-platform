"use client";

import * as React from "react";
import { Input } from "./Input";
import { Button } from "./Button";
import { csrfHeaders } from "@/lib/csrf-client";

// AUT-02: change password. The live hint is lightweight guidance; the SERVER runs the
// authoritative gate (length ≥ 12, zxcvbn ≥ 3, HIBP breach check) and returns specific
// reasons (FRM-01). Passwords are never logged (SEC-05). Extracted (WS-7) so both the
// standalone /account/password page and Settings → Profile host the same form.
const MIN_LEN = 12;

function localHint(pw: string): string {
  if (!pw) return "";
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (pw.length < MIN_LEN) return `At least ${MIN_LEN} characters`;
  if (variety < 2) return "Add more variety (letters, numbers, symbols)";
  return "Looks reasonable — the server will do the final check";
}

export function PasswordChangeForm() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const mismatch = confirm.length > 0 && confirm !== next;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (res.ok) {
        setDone(true);
        setCurrent("");
        setNext("");
        setConfirm("");
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? "Could not update the password.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {done && (
        <p role="status" className="text-sm text-success">
          Your password was updated.
        </p>
      )}
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        required
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => {
          setNext(e.target.value);
          if (done) setDone(false);
        }}
        required
        hint={localHint(next) || undefined}
        error={error ?? undefined}
      />
      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
        error={mismatch ? "Passwords do not match." : undefined}
      />
      <Button type="submit" variant="primary" loading={loading} disabled={mismatch || next.length === 0} className="mt-1 w-fit">
        Update password
      </Button>
    </form>
  );
}
