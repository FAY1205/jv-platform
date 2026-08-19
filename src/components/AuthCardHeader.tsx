import * as React from "react";
import { APP_NAME } from "@/lib/app";

// AuthCardHeader (N3C-07 / C-63) — the ONE identity block for every centered auth card:
// public sign-in/sign-up/recovery, the signed-out terms page, and the two in-app ToS gates.
//
// The divergence this replaces: /login and /portal/login made the PRODUCT NAME the <h1> and
// the screen's purpose a muted sibling, while forgot/reset/verify/signup did the reverse
// (brand in a <span>, purpose muted too — so those pages had no <h1> at all). A screen's
// heading has to say what THIS screen is for; the brand is context, not the task. So:
//   • <h1> = the screen's purpose ("Admin portal sign-in", "Create your workspace", …)
//   • APP_NAME = a muted eyebrow sibling above it (PRN-12 — read from lib/app, never a
//     literal), matching the uppercase 13px chrome eyebrow used across the app.
// `children` carries an optional supplementary line (the terms page's version stamp).
export function AuthCardHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <span className="text-step-1 font-semibold uppercase tracking-[.08em] text-text-3">{APP_NAME}</span>
      <h1 className="font-display text-xl font-semibold tracking-tight text-text">{title}</h1>
      {children}
    </div>
  );
}
