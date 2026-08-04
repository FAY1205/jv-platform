"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, CardHeader, CardTitle, Button } from "@/components";
import { SettingsSection } from "../settings-section";

// WS-7e · ACC-02: account security. Admin sign-in is a password session (no remembered
// devices to enumerate — owner decision 2026-08-01), so this page is just the global
// "sign out everywhere" control (AUT-14 global refresh-token revocation via /api/auth/logout).

export default function SecuritySettingsPage() {
  const qc = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOutEverywhere() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ scope: "global" }),
      });
    } catch {
      // Navigate away regardless — tokens are server-revoked.
    }
    qc.clear();
    window.location.assign("/login");
  }

  return (
    <SettingsSection title="Security" description="Manage how you're signed in.">
      <Card>
        <CardHeader>
          <CardTitle>Sign out everywhere</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-text-2">Ends every session on all devices, including this one. You will need to sign in again.</p>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-text-2">Sign out of all devices?</span>
              <Button variant="danger" size="sm" loading={signingOut} onClick={signOutEverywhere}>
                Yes, sign out everywhere
              </Button>
              <Button variant="ghost" size="sm" disabled={signingOut} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
              Sign out everywhere
            </Button>
          )}
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
