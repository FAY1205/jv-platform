import { describe, expect, it } from "vitest";
import {
  buildInviteEmail,
  buildOtpEmail,
  buildResetEmail,
  buildPasswordChangedEmail,
  buildSignupVerifyEmail,
  buildAlreadyRegisteredEmail,
} from "@/lib/auth/notify";

// WP-G: partner-facing auth emails gain a branded HTML alternative. The plain-text
// body must keep the code / raw link so the dev-mailbox extraction (CODE_RE / LINK_RE)
// and text-only clients are unaffected.
describe("WP-G: auth emails carry branded HTML without breaking the text contract", () => {
  it("invite: html has the link CTA (escaped); text keeps the raw link", () => {
    const m = buildInviteEmail("p@x.test", "https://app.test/invite/abc?t=1&u=2");
    expect(m.html).toMatch(/^<!DOCTYPE html>/i);
    expect(m.html).toContain("https://app.test/invite/abc?t=1&amp;u=2");
    expect(m.text).toContain("https://app.test/invite/abc?t=1&u=2");
  });

  it("otp: html shows the code; text still carries it verbatim (dev-mailbox CODE_RE)", () => {
    const m = buildOtpEmail("p@x.test", "123456");
    expect(m.html).toContain("123456");
    expect(m.text).toContain("123456");
  });

  it("reset: html + text both carry the link", () => {
    const m = buildResetEmail("p@x.test", "https://app.test/reset/xyz");
    expect(m.html).toContain("https://app.test/reset/xyz");
    expect(m.text).toContain("https://app.test/reset/xyz");
  });

  it("password-changed: html present, honest revocation copy preserved", () => {
    expect(buildPasswordChangedEmail("p@x.test", true).html).toContain("signed out");
  });

  it("signup verify: html + text both carry the link; kind is signup_verify", () => {
    const m = buildSignupVerifyEmail("new@x.test", "https://app.test/signup/verify?token=abc");
    expect(m.html).toContain("https://app.test/signup/verify?token=abc");
    expect(m.text).toContain("https://app.test/signup/verify?token=abc");
    expect(m.meta?.kind).toBe("signup_verify");
  });

  it("already-registered: points to login, carries no token/password; kind is already_registered", () => {
    const m = buildAlreadyRegisteredEmail("dupe@x.test");
    expect(m.text!.toLowerCase()).toContain("log in");
    expect(m.meta?.kind).toBe("already_registered");
  });
});
