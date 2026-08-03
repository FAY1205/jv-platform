"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, Button } from "@/components";
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
    <main className="mx-auto w-full max-w-lg flex-1 p-6">
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text">{TOS_TITLE}</h1>
      <Card>
        <CardBody>
          <p className="mb-5 text-sm leading-relaxed text-text-2">{TOS_SUMMARY}</p>
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
    </main>
  );
}
