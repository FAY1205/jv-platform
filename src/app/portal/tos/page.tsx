"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, Button } from "@/components";
import { csrfHeaders } from "@/lib/csrf-client";
import { TOS_TITLE, TOS_SUMMARY } from "@/lib/legal/tos";

// LGL-01: first-login ToS/Privacy acceptance gate. Acceptance activates the partner.
export default function PortalTosPage() {
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
        router.push("/portal/dashboard");
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
          <p className="mb-3 text-sm leading-relaxed text-text-2">{TOS_SUMMARY}</p>
          {/* C-55: the same one-source text on the PUBLIC page, so this gate can point at a
              stable, linkable address. New tab — leaving the gate would just re-gate. */}
          <p className="mb-5">
            <Link href="/terms" target="_blank" rel="noopener" className="text-sm font-semibold text-brand-ink hover:underline">
              Read the full terms
            </Link>
          </p>
          {/* P-8: role="alert" so a screen reader announces the failure — matches the admin
              ToS page (this is the first authenticated screen a new partner sees). */}
          {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
          <Button variant="primary" size="lg" loading={loading} onClick={accept} className="w-full">
            I agree — continue
          </Button>
        </CardBody>
      </Card>
    </main>
  );
}
