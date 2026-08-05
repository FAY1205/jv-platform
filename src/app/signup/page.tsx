"use client";

import * as React from "react";
import Link from "next/link";
import Script from "next/script";
import { Card, CardBody, Input, Button, Checkbox } from "@/components";
import { APP_NAME } from "@/lib/app";

// SCP-02/ADR-0033/ADR-0034: public self-serve signup. POSTs to /api/auth/signup
// (Task 6), which is enumeration-safe (AUT-05) — the response is uniform whether
// or not the email already exists, so the client always shows the same
// "check your email" state on success (res.ok or a throttled 429).
//
// Turnstile SITE key is public and read directly from NEXT_PUBLIC_* (inlined at
// build) — never import @/lib/env here, that module is server-only (holds the
// service-role key) and must not leak into the client bundle.
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

const MIN_LEN = 12;

function localHint(pw: string): string {
  if (!pw) return "";
  if (pw.length < MIN_LEN) return `At least ${MIN_LEN} characters`;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  return variety < 2 ? "Add more variety (letters, numbers, symbols)" : "Looks reasonable — the server does the final check";
}

export default function SignupPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const widgetRef = React.useRef<HTMLDivElement>(null);
  const rendered = React.useRef(false);
  const pollId = React.useRef<number | null>(null);
  const widgetId = React.useRef<string | null>(null);
  const autoRetries = React.useRef(0);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [workspaceName, setWorkspaceName] = React.useState("");
  const [inviteCode, setInviteCode] = React.useState("");
  const [captchaToken, setCaptchaToken] = React.useState("");
  const [tosAccepted, setTosAccepted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [captchaError, setCaptchaError] = React.useState<string | null>(null);
  const [resending, setResending] = React.useState(false);
  const [resendMsg, setResendMsg] = React.useState<string | null>(null);

  const renderWidget = React.useCallback(() => {
    if (rendered.current) return;
    if (typeof window !== "undefined" && window.turnstile && widgetRef.current && siteKey) {
      rendered.current = true;
      widgetId.current = window.turnstile.render(widgetRef.current, {
        sitekey: siteKey,
        callback: (t: string) => {
          autoRetries.current = 0;
          setCaptchaToken(t);
          setCaptchaError(null);
        },
        // A stale Cloudflare clearance cookie makes the widget error even when the keys are
        // fine — and a plain page refresh doesn't clear it, but RE-ISSUING the challenge does.
        // So silently auto-retry once; if it still errors, surface a one-click "Retry
        // verification" (below) instead of the old "refresh the page" that didn't actually help.
        "error-callback": () => {
          setCaptchaToken("");
          if (autoRetries.current < 1 && window.turnstile && widgetId.current != null) {
            autoRetries.current += 1;
            window.turnstile.reset(widgetId.current);
          } else {
            setCaptchaError("Couldn't verify you're human — tap “Retry verification” below.");
          }
        },
        // Expiry is benign — re-issue a fresh challenge in place, no message needed.
        "expired-callback": () => {
          setCaptchaToken("");
          if (window.turnstile && widgetId.current != null) window.turnstile.reset(widgetId.current);
        },
      });
      // The widget is up — stop polling now rather than waiting for unmount.
      if (pollId.current != null) {
        window.clearInterval(pollId.current);
        pollId.current = null;
      }
    }
  }, [siteKey]);

  // Manual recovery for the stubborn case — re-issues the challenge in place (no page reload,
  // no "clear your cookies"): the common fix for a stale Cloudflare clearance cookie.
  const resetWidget = React.useCallback(() => {
    autoRetries.current = 0;
    setCaptchaToken("");
    setCaptchaError(null);
    if (typeof window !== "undefined" && window.turnstile && widgetId.current != null) {
      window.turnstile.reset(widgetId.current);
    }
  }, []);

  React.useEffect(() => {
    renderWidget();
    // The Turnstile script loads async; if it wasn't ready yet on mount, poll
    // briefly until window.turnstile appears (Script's onLoad covers the common
    // case, this covers scripts already cached/loaded before this effect ran).
    pollId.current = window.setInterval(renderWidget, 200);
    return () => {
      if (pollId.current != null) window.clearInterval(pollId.current);
    };
  }, [renderWidget]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!captchaToken || !tosAccepted || !inviteCode.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, workspaceName, inviteCode, captchaToken, tosAccepted }),
      });
      if (res.ok) {
        setSent(true);
        return;
      }
      // WP-B: a 429 previously showed the "check your email" success state even though no email
      // was sent (owner-reported). Surface the throttle honestly — 429 is rate-limiting keyed on
      // email/IP and reveals nothing about whether the account exists (AUT-05 is unaffected).
      if (res.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
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

  async function onResend() {
    if (resending) return;
    setResending(true);
    setResendMsg(null);
    try {
      const res = await fetch("/api/auth/signup/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setResendMsg("If your workspace still needs verifying, we've emailed a new link.");
      } else if (res.status === 429) {
        setResendMsg("Please wait a minute before requesting another link.");
      } else {
        setResendMsg("Couldn't resend just now. Please try again in a moment.");
      }
    } catch {
      setResendMsg("Network error. Please try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer onLoad={renderWidget} />
      <Card className="w-full max-w-sm">
        <CardBody>
          <div className="mb-6 flex flex-col gap-1">
            <span className="font-display text-lg font-semibold text-text">{APP_NAME}</span>
            <span className="text-sm text-text-3">Create your workspace</span>
          </div>
          {sent ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium text-text">Verify your email to activate your account.</p>
              <p className="text-sm text-text-2">
                We&apos;ve sent a verification link to{" "}
                <span className="font-medium text-text">{email}</span>. Click it to finish setting up your
                workspace — the link expires in 24 hours. You can&apos;t sign in until your email is verified.
              </p>
              <p className="text-xs text-text-3">Didn&apos;t get it? Check your spam folder, or resend below.</p>
              <Button type="button" variant="secondary" onClick={onResend} loading={resending} className="w-full">
                Resend verification email
              </Button>
              {resendMsg && (
                <p className="text-xs text-text-3" aria-live="polite">
                  {resendMsg}
                </p>
              )}
              <Link href="/login" className="text-center text-sm font-semibold text-brand-ink hover:underline">
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
              />
              <Input
                label="Password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                hint={localHint(password) || undefined}
              />
              <Input
                label="Workspace name"
                type="text"
                autoComplete="organization"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                required
              />
              <Input
                label="Invitation code"
                type="text"
                autoComplete="off"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
                hint="Enter the code you were given to create a workspace."
              />
              <div ref={widgetRef} />
              {!siteKey && (
                <p className="text-xs text-danger">Verification is unavailable right now. Please try again later.</p>
              )}
              {captchaError && (
                <div className="flex flex-col items-start gap-1.5">
                  <p className="text-xs text-danger" aria-live="polite">
                    {captchaError}
                  </p>
                  <button
                    type="button"
                    onClick={resetWidget}
                    className="rounded text-xs font-semibold text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
                  >
                    Retry verification
                  </button>
                </div>
              )}
              <Checkbox
                checked={tosAccepted}
                onCheckedChange={setTosAccepted}
                label={
                  <span>
                    I agree to the{" "}
                    <Link href="/tos" className="font-semibold text-brand-ink hover:underline">
                      Terms of Service &amp; Privacy Policy
                    </Link>
                  </span>
                }
              />
              {error && <p className="text-xs text-danger">{error}</p>}
              <Button
                type="submit"
                variant="primary"
                loading={loading}
                disabled={!captchaToken || !tosAccepted || !inviteCode.trim() || loading}
                className="mt-1 w-full"
              >
                Sign up
              </Button>
              <p className="mt-4 border-t border-border-soft pt-4 text-center text-sm text-text-2">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-brand-ink hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
