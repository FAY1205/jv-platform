import { sendEmail, type EmailMessage, type EmailTransport } from "@/modules/notify/email";
import { resolveEmailTransport } from "@/modules/notify/transport";
import { escapeHtml, emailButton, renderEmailDocument, EMAIL_COLORS, EMAIL_FONTS } from "@/modules/notify/email-template";
import { adminAllowlist, env, isProduction } from "@/lib/env";
import { APP_NAME } from "@/lib/app";
import { logError } from "@/lib/observability";

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * WP-G: branded HTML for a transactional/security notice. Composes the shared Survey
 * email shell (SEAM-08). Content stays terse — the plain-text `text` on each message
 * remains the source for the dev mailbox (code/link extraction) and text-only clients.
 */
function authNotice(opts: {
  title: string;
  paragraphs: string[];
  cta?: { href: string; label: string };
  code?: string;
}): string {
  const C = EMAIL_COLORS;
  const F = EMAIL_FONTS;
  const body = opts.paragraphs
    .map((p) => `<p style="font-family:${F.body};color:${C.text2};font-size:15px">${escapeHtml(p)}</p>`)
    .join("");
  const codeBlock = opts.code
    ? `<div style="font-family:${F.mono};font-size:34px;letter-spacing:8px;font-weight:700;color:${C.text};` +
      `background:${C.surface2};border:1px solid ${C.border};border-radius:8px;text-align:center;padding:18px 0;margin:6px 0 14px">${escapeHtml(opts.code)}</div>`
    : "";
  const cta = opts.cta ? `<div style="margin-top:20px">${emailButton(opts.cta)}</div>` : "";
  return renderEmailDocument({
    title: opts.title,
    preheader: opts.title,
    heading: opts.title,
    contentHtml: body + codeBlock + cta,
  });
}

// AUT-03/04 transactional security email, plus the PTL-01 partner OTP/invite. These are
// INSTANT (sent directly at action time, never via the 5-min outbox cron — an OTP can't
// wait on a batch). SEC-07: guardOutbound redirects to the sink in non-production, and
// resolveEmailTransport (NTF-03) returns the real Resend transport ONLY in production —
// so dev/preview capture to the /dev/emails mailbox and can never reach a real recipient,
// while production actually delivers. Same resolver the outbox uses; no drift.
function transport(): EmailTransport {
  return resolveEmailTransport({ isProduction, resendKey: env.RESEND_API_KEY, emailFrom: env.EMAIL_FROM });
}

export function buildLockoutEmail(identifier: string): EmailMessage {
  const copy =
    "We detected repeated failed sign-in attempts and temporarily locked your account for safety. It unlocks automatically after a short delay. If this wasn't you, reset your password.";
  return {
    to: identifier,
    subject: "Your account was temporarily locked",
    text: copy,
    html: authNotice({ title: "Your account was temporarily locked", paragraphs: [copy] }),
    meta: { kind: "lockout" },
  };
}

/** The original (and default) headline — sustained failed logins, the AUT-03 login anomaly. */
const DEFAULT_ANOMALY_SUBJECT = "Security alert: sustained failed sign-in attempts";

export function buildAnomalyEmail(
  recipients: string[],
  detail: string,
  // WP-SU-8: overridable because this transport is no longer login-only. A signup-ceiling
  // event arriving under a "failed sign-in attempts" headline invites exactly the wrong
  // diagnosis at exactly the wrong moment.
  subject: string = DEFAULT_ANOMALY_SUBJECT,
): EmailMessage {
  const copy = `Automated security alert: ${detail}. Review the activity log.`;
  return {
    to: recipients,
    subject,
    text: copy,
    html: authNotice({ title: subject, paragraphs: [copy] }),
    meta: { kind: "auth_anomaly" },
  };
}

export function buildResetEmail(email: string, link: string): EmailMessage {
  return {
    to: email,
    subject: "Reset your password",
    text: `We received a request to reset your password. Use this link within 30 minutes:\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
    html: authNotice({
      title: "Reset your password",
      paragraphs: [
        "We received a request to reset your password. Use the button below within 30 minutes. If you didn't request this, you can ignore this email.",
      ],
      cta: { href: link, label: "Reset your password" },
    }),
    meta: { kind: "password_reset" },
  };
}

export function buildPasswordChangedEmail(email: string, sessionsRevoked: boolean): EmailMessage {
  // Only claim revocation when it actually happened — never tell the user their
  // sessions were signed out if we couldn't confirm it (silent-failure honesty).
  const revocationLine = sessionsRevoked
    ? "All other sessions were signed out."
    : "If you were signed in on other devices, sign out everywhere to be safe.";
  const copy = `Your password was just changed. ${revocationLine} If this wasn't you, reset your password immediately and contact your administrator.`;
  return {
    to: email,
    subject: "Your password was changed",
    text: copy,
    html: authNotice({ title: "Your password was changed", paragraphs: [copy] }),
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
    html: authNotice({
      title: `You've been invited to ${APP_NAME}`,
      paragraphs: [
        `You've been invited to the ${APP_NAME} partner portal. Open the link below and enter your email to receive a 6-digit sign-in code.`,
      ],
      cta: { href: link, label: "Accept your invite →" },
    }),
    meta: { kind: "partner_invite" },
  };
}

export function buildOtpEmail(email: string, code: string): EmailMessage {
  return {
    to: email,
    subject: "Your sign-in code",
    text: `Your ${APP_NAME} sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    html: authNotice({
      title: "Your sign-in code",
      paragraphs: [`Your ${APP_NAME} sign-in code (expires in 10 minutes):`],
      code,
    }),
    meta: { kind: "otp" },
  };
}

export function buildTrustReuseEmail(email: string): EmailMessage {
  const copy =
    "We detected reuse of an old 'remember this device' token on your account and signed that device family out as a precaution. If this wasn't you, sign in and review your devices.";
  return {
    to: email,
    subject: "Security alert: a saved device was signed out",
    text: copy,
    html: authNotice({ title: "Security alert: a saved device was signed out", paragraphs: [copy] }),
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

export function buildSignupVerifyEmail(email: string, link: string): EmailMessage {
  return {
    to: email,
    subject: `Verify your email to finish setting up ${APP_NAME}`,
    text: `Welcome to ${APP_NAME}. Confirm your email to activate your workspace — open this link within 24 hours:\n\n${link}\n\nIf you didn't sign up, you can ignore this email.`,
    html: authNotice({
      title: `Verify your email`,
      paragraphs: [`Welcome to ${APP_NAME}. Confirm your email to activate your workspace. This link expires in 24 hours; if you didn't sign up, ignore this email.`],
      cta: { href: link, label: "Verify your email →" },
    }),
    meta: { kind: "signup_verify" },
  };
}

export function buildAlreadyRegisteredEmail(email: string): EmailMessage {
  const copy = `Someone (maybe you) tried to sign up with this email, but an account already exists. If it was you, just log in — no new account is needed. If you forgot your password, use the reset link on the login page.`;
  return {
    to: email,
    subject: `You already have a ${APP_NAME} account`,
    text: copy,
    html: authNotice({ title: `You already have an account`, paragraphs: [copy] }),
    meta: { kind: "already_registered" },
  };
}

/** Email a signup verification link (PTL/SCP-02). Best-effort; failure logged (never the token). */
export async function notifySignupVerify(email: string, link: string): Promise<void> {
  try {
    await sendEmail(buildSignupVerifyEmail(email, link), transport());
  } catch (e) {
    logError("notify_signup_verify_failed", { message: errMessage(e) });
  }
}

/** Notify a would-be signup that they already have an account. Best-effort; failure logged. */
export async function notifyAlreadyRegistered(email: string): Promise<void> {
  try {
    await sendEmail(buildAlreadyRegisteredEmail(email), transport());
  } catch (e) {
    logError("notify_already_registered_failed", { message: errMessage(e) });
  }
}

/** Alert admins to sustained auth abuse (AUT-03). Best-effort; failure logged. */
export async function notifyAuthAnomaly(detail: string, subject?: string): Promise<void> {
  if (adminAllowlist.length === 0) {
    // WP-SU-8: this used to return in silence, which meant a misconfigured ADMIN_ALLOWLIST
    // produced no email AND no trace — the alert channel failing exactly as quietly as the
    // abuse it exists to report. SEC-05: the code only; `detail` is a count, but the
    // allowlist itself is admin PII.
    logError("notify_anomaly_no_recipients");
    return;
  }
  try {
    await sendEmail(buildAnomalyEmail([...adminAllowlist], detail, subject), transport());
  } catch (e) {
    logError("notify_anomaly_failed", { message: errMessage(e) });
  }
}
