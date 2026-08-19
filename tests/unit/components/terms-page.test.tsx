// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

// N3A-02/C-55 (deep-UX audit 2026-08-19): /signup's "I agree to the Terms of Service &
// Privacy Policy" consent link pointed at /tos — a PROTECTED page — so a prospect who
// clicked it before creating an account was redirected to /login and lost the typed form.
// This is the public read-only terms page that fixes the dead end.
//
// It renders from the SAME single source (src/lib/legal/tos.ts) the in-app acceptance gates
// render, so the attorney text from WP-LGL-1 swaps in there once and this page updates for
// free. These tests pin that sourcing — a hardcoded copy of the text here would pass a
// naive "does it say terms" assertion but silently drift from the version users accepted.
import { CURRENT_TOS_VERSION, TOS_TITLE, TOS_SUMMARY } from "@/lib/legal/tos";
import TermsPage from "@/app/terms/page";

describe("/terms — the public legal page", () => {
  it("N3A-02/C-55: /terms renders the ToS title, summary and current version from lib/legal/tos", () => {
    render(<TermsPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TOS_TITLE);
    expect(screen.getByText(TOS_SUMMARY)).toBeTruthy();
    // The effective-version line — the same string recorded per user in tos_acceptances,
    // so a reader can tell WHICH version this page is showing.
    expect(screen.getByText(new RegExp(CURRENT_TOS_VERSION))).toBeTruthy();
  });

  it("N3A-02/C-55: /terms is a static read-only page — no acceptance control (the gate owns that)", () => {
    render(<TermsPage />);

    // The acceptance flow lives on the gated /tos screens and is out of scope here; a
    // stray "I agree" button on a signed-out public page would post nowhere.
    expect(screen.queryByRole("button")).toBeNull();
  });
});
