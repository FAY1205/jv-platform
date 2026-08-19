import type { Metadata } from "next";
import { Card, CardBody } from "@/components";
import { APP_NAME } from "@/lib/app";
import { CURRENT_TOS_VERSION, TOS_TITLE, TOS_SUMMARY } from "@/lib/legal/tos";

// LGL-01 / C-55 (deep-UX audit 2026-08-19, owner decision 2026-08-19): the PUBLIC,
// read-only terms page.
//
// The signup form's consent checkbox linked to /tos — the in-app ACCEPTANCE gate, which is
// a protected page — so a prospect who wanted to read the terms before creating an account
// was redirected to /login and lost everything they had typed. This page is that link's
// real destination.
//
// It is public by ABSENCE from PROTECTED_PAGE_PREFIXES in src/proxy.ts (that list is an
// allowlist of protected prefixes); see the note there. A server component with no auth,
// no data fetch and no client JS.
//
// Single source of truth: the title/summary/version below are the SAME exports the two
// in-app gates ((admin)/tos and portal/tos) render, so the finalized attorney documents
// (WP-LGL-1) swap in at src/lib/legal/tos.ts once and every surface updates together —
// this page can never drift from the version users actually accepted.

export const metadata: Metadata = {
  title: `Terms of Service & Privacy Policy — ${APP_NAME}`,
  description: "The Terms of Service and Privacy Policy governing use of the platform.",
};

export default function TermsPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardBody>
          <h1 className="font-display text-xl font-semibold tracking-tight text-text">{TOS_TITLE}</h1>
          {/* The effective version — the same string recorded per user+version in
              tos_acceptances, so a reader can tell WHICH revision this is. */}
          <p className="mt-1 text-step-1 text-text-3">
            Version <span className="num">{CURRENT_TOS_VERSION}</span>
          </p>
          <p className="mt-5 text-sm leading-relaxed text-text-2">{TOS_SUMMARY}</p>
        </CardBody>
      </Card>
    </main>
  );
}
