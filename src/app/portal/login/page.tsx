"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardBody, Input, Button, Checkbox } from "@/components";
import { APP_NAME } from "@/lib/app";

// PTL-01 + AUT-10: partner sign-in. On load we silently try the trusted-device
// route (skip OTP for a remembered browser); on 401 we fall back to email → code.
function PortalLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/portal/dashboard";

  const [checking, setChecking] = React.useState(true);
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [remember, setRemember] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const goNext = React.useCallback(
    (tosRequired?: boolean) => {
      router.push(tosRequired ? "/portal/tos" : next);
      router.refresh();
    },
    [router, next],
  );

  // Trusted-device auto sign-in.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/trust/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!active) return;
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { tosRequired?: boolean } | null;
          goNext(body?.tosRequired);
          return;
        }
      } catch {
        /* fall through to OTP */
      }
      if (active) setChecking(false);
    })();
    return () => {
      active = false;
    };
  }, [goNext]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok || res.status === 429) {
        setStep("code");
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

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, remember }),
      });
      const body = (await res.json().catch(() => null)) as { tosRequired?: boolean; message?: string } | null;
      if (res.ok) {
        goNext(body?.tosRequired);
        return;
      }
      setError(body?.message ?? "That code is invalid or has expired.");
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
            <h1 className="font-display text-lg font-semibold text-text">{APP_NAME}</h1>
            <span className="text-sm text-text-3">Partner portal sign-in</span>
          </div>

          {checking ? (
            <p className="py-4 text-sm text-text-3">Checking this device…</p>
          ) : step === "email" ? (
            <form onSubmit={requestCode} className="flex flex-col gap-4" noValidate>
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                error={error ?? undefined}
              />
              <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-1 w-full">
                Send code
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="flex flex-col gap-4" noValidate>
              <p className="text-sm text-text-3">
                If an account exists for <span className="text-text-2">{email}</span>, we&apos;ve sent a 6-digit code.
              </p>
              <Input
                label="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
                error={error ?? undefined}
                className="font-mono tracking-[0.3em]"
              />
              <Checkbox checked={remember} onCheckedChange={setRemember} label="Remember this device for 30 days" />
              <Button type="submit" variant="primary" size="lg" loading={loading} disabled={code.length !== 6} className="mt-1 w-full">
                Verify &amp; sign in
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
                className="inline-flex min-h-11 items-center justify-center text-center text-sm text-text-3 hover:text-text-2"
              >
                Use a different email
              </button>
            </form>
          )}
        </CardBody>
      </Card>
    </main>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <PortalLoginForm />
    </Suspense>
  );
}
