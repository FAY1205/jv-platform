"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { csrfHeaders } from "@/lib/csrf-client";

// The one account sign-out (AUT-14 — server-side revoke, then a full navigation that
// drops the client cache). Extracted from the portal account body (WP-PW-4) and, since
// WP-PP-6, shared by the admin ProfileMenu too via the `redirectTo` option (the admin
// lands on /login, the portal on /portal/login). Behavior-preserving DRY: same fetch/
// body/headers, same qc.clear(), same navigation — one implementation, not three copies.
export function useSignOut(redirectTo: string = "/portal/login") {
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
    window.location.assign(redirectTo);
  }

  return { signOut, signingOut };
}
