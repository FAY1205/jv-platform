"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { csrfHeaders } from "@/lib/csrf-client";

// WP-PW-4 Task 2: the portal account sign-out (AUT-14 — server-side revoke, then a full
// navigation that drops the client cache), extracted VERBATIM from the pre-WP-PW-4
// PortalAccount body so AccountMobile and AccountDesktop share one implementation
// instead of two copies that could drift. Behavior-preserving DRY: same fetch/body/
// headers, same qc.clear(), same navigation.
export function useSignOut() {
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ scope: "local" }),
      });
    } catch {
      // Navigate away regardless — the session cookie is HttpOnly + server-revoked.
    }
    qc.clear();
    window.location.assign("/portal/login");
  }

  return { signOut, signingOut };
}
