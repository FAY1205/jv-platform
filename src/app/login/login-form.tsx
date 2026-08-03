"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardBody, Input, Button } from "@/components";
import { APP_NAME } from "@/lib/app";

// Admin sign-in (AUT-05). The failure message is uniform and comes from the server;
// partners never see this screen (they onboard via email-OTP — PTL-01, WP-025).
// `signupEnabled` is resolved server-side (isSignupEnabled) and passed in by page.tsx, so the
// "Sign up" link stays hidden when public signup is off (the compliance kill-switch) — the flag
// never has to leak into the client bundle as a public env var.
export function LoginForm({ signupEnabled = false }: { signupEnabled?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push(next);
        router.refresh();
        return; // keep the button spinning while we navigate — don't flash back to idle
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? "Sign in failed. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardBody>
          <div className="mb-6 flex flex-col gap-1">
            <h1 className="font-display text-lg font-semibold text-text">{APP_NAME}</h1>
            <span className="text-sm text-text-3">Admin portal sign-in</span>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Input
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              error={error ?? undefined}
            />
            <Button type="submit" variant="primary" loading={loading} className="mt-1 w-full">
              Sign in
            </Button>
            <Link href="/forgot" className="text-center text-sm font-medium text-brand-ink hover:underline">
              Forgot password?
            </Link>
          </form>
          <div className="mt-5 flex flex-col gap-3 border-t border-border-soft pt-4 text-center text-sm">
            {signupEnabled && (
              <p className="text-text-2">
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="font-semibold text-brand-ink hover:underline">
                  Sign up
                </Link>
              </p>
            )}
            <p className="text-text-3">
              Are you a partner?{" "}
              <Link href="/portal/login" className="font-semibold text-brand-ink hover:underline">
                Sign in to the partner portal
              </Link>
            </p>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
