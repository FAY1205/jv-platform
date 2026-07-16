"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardBody, Button } from "@/components";
import { APP_NAME } from "@/lib/app";

// SCP-02: the new-signup verification landing page. The confirm click (not an
// auto-POST on mount) matters — email scanners issue automatic GETs against
// links in inboxes, and this token is single-use, so the POST only fires on a
// real user action.

function VerifyForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onVerify() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? "This link is invalid or has expired.");
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
            <span className="text-sm text-text-3">Verify your email</span>
          </div>
          {done ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-success">Your email is verified.</p>
              <Link href="/login" className="text-sm font-semibold text-brand-ink hover:underline">
                Sign in
              </Link>
            </div>
          ) : !token ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-danger">This link is invalid or missing.</p>
              <Link href="/signup" className="text-sm font-semibold text-brand-ink hover:underline">
                Back to sign up
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-2">Confirm below to finish setting up your workspace.</p>
              {error && <p className="text-xs text-danger">{error}</p>}
              <Button type="button" variant="primary" loading={loading} onClick={onVerify} className="mt-1 w-full">
                Verify my email
              </Button>
              {error && (
                <Link href="/signup" className="text-center text-sm text-text-3 hover:text-text-2">
                  Back to sign up
                </Link>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </main>
  );
}

export default function SignupVerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  );
}
