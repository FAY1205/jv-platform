"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardBody, Input, Button } from "@/components";
import { APP_NAME } from "@/lib/app";

// AUT-06: set a new password from a reset link. The token comes from the emailed
// URL; strength is guided client-side and enforced authoritatively server-side.
const MIN_LEN = 12;

function localHint(pw: string): string {
  if (!pw) return "";
  if (pw.length < MIN_LEN) return `At least ${MIN_LEN} characters`;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  return variety < 2 ? "Add more variety (letters, numbers, symbols)" : "Looks reasonable — the server does the final check";
}

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: next }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? "Could not reset the password.");
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
            <span className="text-sm text-text-3">Choose a new password</span>
          </div>
          {done ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-success">Your password was updated and all sessions were signed out.</p>
              <Link href="/login" className="text-sm font-semibold text-brand-ink hover:underline">
                Sign in
              </Link>
            </div>
          ) : !token ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-danger">This reset link is missing its token.</p>
              <Link href="/forgot" className="text-sm font-semibold text-brand-ink hover:underline">
                Request a new reset link
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
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
              <Button type="submit" variant="primary" loading={loading} disabled={mismatch || next.length === 0} className="mt-1 w-full">
                Set new password
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </main>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
