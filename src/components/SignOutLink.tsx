"use client";

import { useSignOut } from "@/lib/use-sign-out";

// SignOutLink (N3C-06 / owner Q9) — the quiet "get me out of here" escape under a card
// that has no app chrome around it. Today's user is the ToS gate: it hides the whole app
// behind an accept button, and before this the ONLY way out of an agreement you did not
// want to sign was closing the tab (the session cookie then let you straight back in).
//
// Both gates render it, so it is a primitive rather than two copies (FRONTEND_STANDARDS §2);
// `redirectTo` is the caller's own login screen — the admin lands on /login, the partner on
// /portal/login. The revoke itself is useSignOut's (AUT-14), unchanged.
//
// DSN-03: default / hover / focus-visible / active / disabled+pending are all expressed;
// min-h-11 keeps the tap target at the 44px floor even though it reads as a text link.
export function SignOutLink({ redirectTo }: { redirectTo: string }) {
  const { signOut, signingOut } = useSignOut(redirectTo);
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={signingOut}
      className={
        "inline-flex min-h-11 items-center justify-center rounded px-2 text-sm font-medium text-text-3 outline-none transition-colors " +
        "hover:text-text-2 active:text-text focus-visible:ring-1 focus-visible:ring-brand-ink " +
        "disabled:cursor-not-allowed disabled:text-text-3 disabled:opacity-60"
      }
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
