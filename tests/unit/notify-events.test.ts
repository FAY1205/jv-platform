import { describe, expect, it } from "vitest";
import { importFailurePhrase, leadDeepLinkFor, type ImportFailureClass } from "@/modules/notify/events";

// WP-NF2 NTF-11: the PURE parts of the four new emit sites. The recipient sets, channel
// gating and payload hygiene are proved live in tests/integration/nf2-new-types.test.ts —
// these are the two decisions that need no database to be wrong.

describe("NTF-11: role-appropriate lead deep links", () => {
  it("NTF-11: the ASSIGNEE's stream decides the app, not the actor's", () => {
    // The bug this pins: an admin assigning a task to a partner seat. Keying the link on the
    // actor would send that partner into the admin app, where they have no session at all.
    expect(leadDeepLinkFor("admin", "LD-26-00042")).toBe("/leads?open=LD-26-00042");
    expect(leadDeepLinkFor("partner", "LD-26-00042")).toBe("/portal/leads/LD-26-00042");
  });

  it("NTF-11: the lead ref is URL-encoded on both arms (defence in depth)", () => {
    // A lead ref is format-constrained upstream, so this can't fire today — it is here so the
    // encoding survives a future ref format, matching the notifyStatusChange convention.
    expect(leadDeepLinkFor("admin", "LD 26/1")).toBe("/leads?open=LD%2026%2F1");
    expect(leadDeepLinkFor("partner", "LD 26/1")).toBe("/portal/leads/LD%2026%2F1");
  });
});

describe("NTF-11: import failure classes", () => {
  it("NTF-11/ING-08: every failure class has its own human phrase", () => {
    const classes: ImportFailureClass[] = ["missing_required", "unrecognized", "process_failed"];
    const phrases = classes.map(importFailurePhrase);
    // Distinct, non-empty, and lower-case so they read as a clause after the filename in the
    // title ("Import failed: leads.xlsx — required columns are missing").
    expect(new Set(phrases).size).toBe(classes.length);
    for (const p of phrases) {
      expect(p.length).toBeGreaterThan(0);
      expect(p[0]).toBe(p[0].toLowerCase());
    }
  });

  it("NTF-11: the phrases name the ING-08 outcome, not an internal code", () => {
    expect(importFailurePhrase("missing_required")).toContain("required columns");
    expect(importFailurePhrase("unrecognized")).toContain("format");
    expect(importFailurePhrase("process_failed")).toContain("processing");
  });
});
