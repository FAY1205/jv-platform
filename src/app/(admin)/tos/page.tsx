"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, Button, AuthCardHeader, SignOutLink } from "@/components";
import { csrfHeaders } from "@/lib/csrf-client";
import { TOS_TITLE, TOS_SUMMARY } from "@/lib/legal/tos";

// LGL-01 (WP-SU-5b): the ADMIN-side ToS acceptance screen — the escape hatch for a
// self-serve admin whom the gate has stopped after a CURRENT_TOS_VERSION bump. It mirrors
// /portal/tos and posts to the same role-agnostic /api/auth/tos/accept.
//
// Deliberately NOT gated itself (see tos-guard.ts): gating the page that clears the gate
// would be a redirect loop with no way out.
export default function AdminTosPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function accept() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/tos/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: "{}",
      });
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? "Could not record acceptance. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    // C-63: the gate rejoins the centered auth-card identity — same layout, same shared
    // header as /login and /terms. It is the first (and possibly only) screen a gated user
    // can see, so it must carry the product identity like every other signed-out card.
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <Card>
          <CardBody>
            <AuthCardHeader title={TOS_TITLE} />
            <p className="mb-3 text-sm leading-relaxed text-text-2">{TOS_SUMMARY}</p>
            {/* C-55: the same one-source text on the PUBLIC page, so this gate can point at a
                stable, linkable address. New tab — leaving the gate would just re-gate. */}
            <p className="mb-5">
              <Link href="/terms" target="_blank" rel="noopener" className="text-sm font-semibold text-brand-ink hover:underline">
                Read the full terms
              </Link>
            </p>
            {error && (
              <p role="alert" className="mb-3 text-sm text-danger">
                {error}
              </p>
            )}
            <Button variant="primary" size="lg" loading={loading} onClick={accept} className="w-full">
              I agree — continue
            </Button>
          </CardBody>
        </Card>
        {/* Q9 (N3C-06): declining used to be a dead end — the gate hides the whole app and
            the session cookie put you straight back on it. This is the way out. */}
        <p className="mt-2 text-center">
          <SignOutLink redirectTo="/login" />
        </p>
      </div>
    </main>
  );
}
