import {
  sendEmail,
  MemoryTransport,
  type EmailMessage,
  type EmailTransport,
} from "@/modules/notify/email";
import { adminAllowlist } from "@/lib/env";
import { APP_NAME } from "@/lib/app";

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

export function buildResetEmail(email: string, link: string): EmailMessage {
  return {
    to: email,
    subject: "Reset your password",
    text: `We received a request to reset your password. Use this link within 30 minutes:\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
    meta: { kind: "password_reset" },
  };
}

export function buildPasswordChangedEmail(email: string): EmailMessage {
  return {
    to: email,
    subject: "Your password was changed",
    text: "Your password was just changed and all sessions were signed out. If this wasn't you, reset your password immediately and contact your administrator.",
    meta: { kind: "password_changed" },
  };
}

/** Email a reset link (AUT-06). Best-effort. */
export async function notifyReset(email: string, link: string): Promise<void> {
  try {
    await sendEmail(buildResetEmail(email, link), transport());
  } catch {
    /* best-effort */
  }
}

/** Notify that the password changed (AUT-06). Best-effort. */
export async function notifyPasswordChanged(email: string): Promise<void> {
  try {
    await sendEmail(buildPasswordChangedEmail(email), transport());
  } catch {
    /* best-effort */
  }
}

export function buildInviteEmail(email: string, link: string): EmailMessage {
  return {
    to: email,
    subject: `You've been invited to ${APP_NAME}`,
    text: `You've been invited to the ${APP_NAME} partner portal. Open this link and enter your email to receive a 6-digit sign-in code:\n\n${link}`,
    meta: { kind: "partner_invite" },
  };
}

export function buildOtpEmail(email: string, code: string): EmailMessage {
  return {
    to: email,
    subject: "Your sign-in code",
    text: `Your ${APP_NAME} sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    meta: { kind: "otp" },
  };
}

/** Email a partner invite link (PTL-01). Best-effort. */
export async function notifyInvite(email: string, link: string): Promise<void> {
  try {
    await sendEmail(buildInviteEmail(email, link), transport());
  } catch {
    /* best-effort */
  }
}

/** Email a 6-digit OTP code (PTL-01). Best-effort. */
export async function notifyOtp(email: string, code: string): Promise<void> {
  try {
    await sendEmail(buildOtpEmail(email, code), transport());
  } catch {
    /* best-effort */
  }
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
