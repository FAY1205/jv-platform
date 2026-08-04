import { beforeEach, describe, expect, it } from "vitest";
import type { OutboundEmail } from "@/modules/notify/email";
import {
  clearDevMailbox,
  recordDevEmail,
  recentDevEmails,
} from "@/modules/notify/dev-mailbox";

// Dev-only "sent emails" viewer core (unblocks owner self-testing of the partner
// OTP / invite / reset flows while all mail is redirected to the SEC-07 sink).
// The store + projection are pure and here unit-tested; the route/page gates are
// live-verified. SEC-07: this surface only ever exists in non-production.

function outbound(partial: Partial<OutboundEmail> & { subject: string }): OutboundEmail {
  return {
    to: ["dev-sink@example.test"],
    intendedTo: ["real@partner.example"],
    redirected: true,
    ...partial,
  };
}

describe("dev-mailbox", () => {
  beforeEach(() => clearDevMailbox());

  it("DEV-EMAIL-01: lists captured emails newest-first", () => {
    recordDevEmail(outbound({ subject: "first" }), "2026-07-08T10:00:00.000Z");
    recordDevEmail(outbound({ subject: "second" }), "2026-07-08T10:01:00.000Z");
    recordDevEmail(outbound({ subject: "third" }), "2026-07-08T10:02:00.000Z");

    const views = recentDevEmails();
    expect(views.map((v) => v.subject)).toEqual(["third", "second", "first"]);
  });

  it("DEV-EMAIL-02: surfaces the 6-digit OTP code for otp emails", () => {
    recordDevEmail(
      outbound({
        subject: "Your sign-in code",
        text: "Your sign-in code is 481920. It expires in 10 minutes.",
        meta: { kind: "otp" },
      }),
    );
    expect(recentDevEmails()[0].code).toBe("481920");
  });

  it("DEV-EMAIL-03: never surfaces a code for non-otp emails", () => {
    // A reset token can contain digit runs — those must not be shown as a code.
    recordDevEmail(
      outbound({
        subject: "Reset your password",
        text: "Use this link: https://app.test/reset?token=abc123456def",
        meta: { kind: "password_reset" },
      }),
    );
    expect(recentDevEmails()[0].code).toBeNull();
  });

  it("DEV-EMAIL-04: extracts links from invite/reset emails", () => {
    recordDevEmail(
      outbound({
        subject: "You've been invited",
        text: "Open this link:\n\nhttps://app.test/portal/login\n\nand enter your email.",
        meta: { kind: "partner_invite" },
      }),
    );
    expect(recentDevEmails()[0].links).toEqual(["https://app.test/portal/login"]);
  });

  it("DEV-EMAIL-05: preserves the intended real recipient for the audit view", () => {
    recordDevEmail(
      outbound({ subject: "Digest", intendedTo: ["randy@partner.example"] }),
    );
    const view = recentDevEmails()[0];
    expect(view.intendedTo).toEqual(["randy@partner.example"]);
    expect(view.redirected).toBe(true);
  });

  it("DEV-EMAIL-06: limits the number of returned emails", () => {
    for (let i = 0; i < 10; i++) recordDevEmail(outbound({ subject: `e${i}` }));
    expect(recentDevEmails(3)).toHaveLength(3);
    expect(recentDevEmails(3)[0].subject).toBe("e9");
  });
});
