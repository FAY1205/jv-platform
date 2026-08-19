"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardBody, Button, AuthCardHeader } from "@/components";

// SCP-02: the new-signup verification landing page. The confirm click (not an
// auto-POST on mount) matters — email scanners issue automatic GETs against
// links in inboxes, and this token is single-use, so the POST only fires on a
// real user action.

function VerifyForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [doneMsg, setDoneMsg] = React.useState("Your email is verified.");
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
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      // WP-B: res.ok now covers BOTH signup_verified and signup_already_verified (a double-click
      // or a refresh of this page after success), so a repeat shows a calm confirmation instead of
      // the old alarming "this link is invalid or has expired" for an account that is in fact active.
      if (res.ok) {
        setDoneMsg(body?.message ?? "Your email is verified.");
        setDone(true);
        return;
      }
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
          <AuthCardHeader title="Verify your email" />
          {done ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-success">{doneMsg}</p>
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
                <div className="flex flex-col gap-1 text-center text-sm">
                  <Link href="/login" className="font-semibold text-brand-ink hover:underline">
                    Go to sign in
                  </Link>
                  <Link href="/signup" className="text-text-3 hover:text-text-2">
                    Start a new sign up
                  </Link>
                </div>
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
