import {
  sendEmail,
  MemoryTransport,
  type EmailMessage,
  type EmailTransport,
} from "@/modules/notify/email";
import { adminAllowlist } from "@/lib/env";

// AUT-03/04 transactional security email. Routed through the SEC-07 sink guard in
// non-production. Uses an in-memory transport as the dev stand-in; WP-028 swaps in
// the Resend transport + outbox (NTF-03) behind the same sendEmail seam.

let devTransport: EmailTransport | null = null;
function transport(): EmailTransport {
  return (devTransport ??= new MemoryTransport());
}

export function buildLockoutEmail(identifier: string): EmailMessage {
  return {
    to: identifier,
    subject: "Your account was temporarily locked",
    text: "We detected repeated failed sign-in attempts and temporarily locked your account for safety. It unlocks automatically after a short delay. If this wasn't you, reset your password.",
    meta: { kind: "lockout" },
  };
}

export function buildAnomalyEmail(recipients: string[], detail: string): EmailMessage {
  return {
    to: recipients,
    subject: "Security alert: sustained failed sign-in attempts",
    text: `Automated security alert: ${detail}. Review the activity log.`,
    meta: { kind: "auth_anomaly" },
  };
}

/** Notify the account owner that their account locked (AUT-04). Best-effort. */
export async function notifyLockout(identifier: string): Promise<void> {
  try {
    await sendEmail(buildLockoutEmail(identifier), transport());
  } catch {
    /* email delivery is best-effort; never block the auth response on it */
  }
}

/** Alert admins to sustained auth abuse (AUT-03). Best-effort. */
export async function notifyAuthAnomaly(detail: string): Promise<void> {
  if (adminAllowlist.length === 0) return;
  try {
    await sendEmail(buildAnomalyEmail([...adminAllowlist], detail), transport());
  } catch {
    /* best-effort */
  }
}
