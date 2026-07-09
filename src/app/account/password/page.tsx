"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle, Input, Button } from "@/components";
import { csrfHeaders } from "@/lib/csrf-client";

// AUT-02: change password. Live feedback here is a lightweight guidance hint; the
// SERVER runs the authoritative gate (length ≥ 12, zxcvbn ≥ 3, HIBP breach check)
// and returns specific reasons on rejection (FRM-01). Passwords are never logged.
const MIN_LEN = 12;

function localHint(pw: string): { label: string; ok: boolean } {
  if (!pw) return { label: "", ok: false };
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (pw.length < MIN_LEN) return { label: `At least ${MIN_LEN} characters`, ok: false };
  if (variety < 2) return { label: "Add more variety (letters, numbers, symbols)", ok: false };
  return { label: "Looks reasonable — the server will do the final check", ok: true };
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const hint = localHint(next);
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
    <main className="mx-auto w-full max-w-md flex-1 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardBody>
          {done ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-success">Your password was updated.</p>
              <Button variant="secondary" onClick={() => router.push("/dashboard")} className="w-fit">
                Back to dashboard
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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
                onChange={(e) => setNext(e.target.value)}
                required
                hint={hint.label || undefined}
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
              <Button
                type="submit"
                variant="primary"
                loading={loading}
                disabled={mismatch || next.length === 0}
                className="mt-1 w-fit"
              >
                Update password
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
