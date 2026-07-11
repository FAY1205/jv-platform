"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardBody, Input, Button } from "@/components";
import { APP_NAME } from "@/lib/app";

// AUT-05/06: request a reset link. The response is uniform — the page shows the same
// confirmation whether or not an account exists.
export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok || res.status === 429) {
        setSent(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? "Something went wrong. Please try again.");
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
            <span className="text-sm text-text-3">Reset your password</span>
          </div>
          {sent ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-2">
                If an account exists for that email, we&apos;ve sent a reset link. It expires in 30 minutes.
              </p>
              <Link href="/login" className="text-sm font-semibold text-brand-ink hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <Input
                label="Email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                error={error ?? undefined}
              />
              <Button type="submit" variant="primary" loading={loading} className="mt-1 w-full">
                Send reset link
              </Button>
              <Link href="/login" className="text-center text-sm text-text-3 hover:text-text-2">
                Back to sign in
              </Link>
            </form>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
