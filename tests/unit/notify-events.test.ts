import { describe, expect, it } from "vitest";
import {
  TITLE_FILENAME_MAX,
  importFailurePhrase,
  leadDeepLinkFor,
  titleSafeFilename,
  type ImportFailureClass,
} from "@/modules/notify/events";

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

describe("NTF-11/SEC-05: filename normalization for a one-line title", () => {
  it("NTF-11: an ordinary filename is passed through untouched", () => {
    // Normalization must be invisible for the 99% case — a real upload name is the most
    // useful thing in the notification and must not be mangled to make the guard's point.
    expect(titleSafeFilename("august-leads-2026.xlsx")).toBe("august-leads-2026.xlsx");
    expect(titleSafeFilename("Q3 leads (final).xlsx")).toBe("Q3 leads (final).xlsx");
  });

  it("NTF-11: CR/LF and control characters cannot split the title into two lines", () => {
    // The upload body admits 255 characters of arbitrary text. An embedded newline would
    // break a rendered title in two — and, since this string is also the email SUBJECT, a
    // CRLF is the classic header-injection shape. Controls become a SPACE, not nothing, so
    // two names can never collapse into the same normalized string.
    const injected = "leads.xlsx\r\nBcc: someone@elsewhere.test";
    const safe = titleSafeFilename(injected);
    expect(safe).not.toMatch(/[\r\n]/);
    expect(safe).toBe("leads.xlsx Bcc: someone@elsewhere.test");
    expect(titleSafeFilename("a\u0000b\u0007c\u001fd\u007fe\u009ff")).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(titleSafeFilename("a\u0007b")).toBe("a b");
  });

  it("NTF-11: whitespace runs collapse and the result is trimmed", () => {
    expect(titleSafeFilename("  spaced   out \t\t name.xlsx  ")).toBe("spaced out name.xlsx");
  });

  it("NTF-11: an over-long name is capped with an ellipsis, so it never reads as complete", () => {
    const long = `${"x".repeat(300)}.xlsx`;
    const safe = titleSafeFilename(long);
    expect(safe).toHaveLength(TITLE_FILENAME_MAX);
    expect(safe.endsWith("…")).toBe(true);
    // A name exactly at the cap is NOT truncated (no off-by-one that ellipsises a fitting name).
    const exact = "y".repeat(TITLE_FILENAME_MAX);
    expect(titleSafeFilename(exact)).toBe(exact);
  });

  it("NTF-11: a name that is entirely whitespace/controls degrades to a placeholder", () => {
    // Never an empty string: "Import failed:  — processing failed" reads like a rendering bug.
    expect(titleSafeFilename("   \r\n\t ")).toBe("(unnamed file)");
    expect(titleSafeFilename("")).toBe("(unnamed file)");
  });
});
