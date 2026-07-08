import { sendEmail, type EmailMessage, type EmailTransport } from "@/modules/notify/email";
import { DevMailboxTransport } from "@/modules/notify/dev-mailbox";
import { adminAllowlist } from "@/lib/env";
import { APP_NAME } from "@/lib/app";
import { logError } from "@/lib/observability";

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// AUT-03/04 transactional security email. Routed through the SEC-07 sink guard in
// non-production. The dev stand-in records every captured message into the dev
// mailbox so the non-prod /dev/emails viewer can surface OTP codes / invite +
// reset links (the owner has no real inbox in dev). WP-028 swaps in the Resend
// transport + outbox (NTF-03) behind the same sendEmail seam.

let devTransport: EmailTransport | null = null;
function transport(): EmailTransport {
  return (devTransport ??= new DevMailboxTransport());
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

export function buildPasswordChangedEmail(email: string, sessionsRevoked: boolean): EmailMessage {
  // Only claim revocation when it actually happened — never tell the user their
  // sessions were signed out if we couldn't confirm it (silent-failure honesty).
  const revocationLine = sessionsRevoked
    ? "All other sessions were signed out."
    : "If you were signed in on other devices, sign out everywhere to be safe.";
  return {
    to: email,
    subject: "Your password was changed",
    text: `Your password was just changed. ${revocationLine} If this wasn't you, reset your password immediately and contact your administrator.`,
    meta: { kind: "password_changed" },
  };
}

/** Email a reset link (AUT-06). Best-effort, but delivery failure is logged. */
export async function notifyReset(email: string, link: string): Promise<void> {
  try {
    await sendEmail(buildResetEmail(email, link), transport());
  } catch (e) {
    logError("notify_reset_failed", { message: errMessage(e) });
  }
}

/** Notify that the password changed (AUT-06). Best-effort; delivery failure logged. */
export async function notifyPasswordChanged(email: string, sessionsRevoked: boolean): Promise<void> {
  try {
    await sendEmail(buildPasswordChangedEmail(email, sessionsRevoked), transport());
  } catch (e) {
    logError("notify_password_changed_failed", { message: errMessage(e) });
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

export function buildTrustReuseEmail(email: string): EmailMessage {
  return {
    to: email,
    subject: "Security alert: a saved device was signed out",
    text: "We detected reuse of an old 'remember this device' token on your account and signed that device family out as a precaution. If this wasn't you, sign in and review your devices.",
    meta: { kind: "trust_reuse" },
  };
}

/** Notify on trusted-device token reuse (AUT-10). Best-effort; failure logged. */
export async function notifyTrustReuse(email: string): Promise<void> {
  try {
    await sendEmail(buildTrustReuseEmail(email), transport());
  } catch (e) {
    logError("notify_trust_reuse_failed", { message: errMessage(e) });
  }
}

/** Email a partner invite link (PTL-01). Best-effort; delivery failure logged. */
export async function notifyInvite(email: string, link: string): Promise<void> {
  try {
    await sendEmail(buildInviteEmail(email, link), transport());
  } catch (e) {
    logError("notify_invite_failed", { message: errMessage(e) });
  }
}

/** Email a 6-digit OTP code (PTL-01). Best-effort; delivery failure logged (never the code). */
export async function notifyOtp(email: string, code: string): Promise<void> {
  try {
    await sendEmail(buildOtpEmail(email, code), transport());
  } catch (e) {
    logError("notify_otp_failed", { message: errMessage(e) });
  }
}

/** Notify the account owner that their account locked (AUT-04). Best-effort. */
export async function notifyLockout(identifier: string): Promise<void> {
  try {
    await sendEmail(buildLockoutEmail(identifier), transport());
  } catch (e) {
    // Best-effort (never block the auth response), but a failed security alert is logged.
    logError("notify_lockout_failed", { message: errMessage(e) });
  }
}

/** Alert admins to sustained auth abuse (AUT-03). Best-effort; failure logged. */
export async function notifyAuthAnomaly(detail: string): Promise<void> {
  if (adminAllowlist.length === 0) return;
  try {
    await sendEmail(buildAnomalyEmail([...adminAllowlist], detail), transport());
  } catch (e) {
    logError("notify_anomaly_failed", { message: errMessage(e) });
  }
}
