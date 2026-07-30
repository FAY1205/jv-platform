import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { env, isSignupEnabled } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { withUniformTiming } from "@/lib/auth/enumeration";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import {
  evaluateThrottle,
  SIGNUP_THROTTLE,
  SIGNUP_GLOBAL_CEILING,
  SIGNUP_SURGE_THRESHOLD,
  SIGNUP_CEILING_RETRY_SEC,
} from "@/lib/auth/throttle";
import { evaluateSignupSurge } from "@/lib/auth/signup-surge";
import { clientIp } from "@/lib/auth/client-ip";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { evaluateNewPassword, hibpRangeFetcher } from "@/lib/auth/password";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { provisionSignup, SignupEmailExistsError } from "@/lib/auth/provision-signup";
import { issueSignupToken } from "@/lib/auth/signup-token";
import { SignupStore } from "@/lib/auth/signup-store";
import { notifySignupVerify, notifyAlreadyRegistered, notifyAuthAnomaly } from "@/lib/auth/notify";
import { emailExistsGlobally } from "@/lib/auth/email-exists";
import { allowAlreadyRegisteredMail, allowSignupAlert } from "@/lib/auth/notice-budget";
import { logError } from "@/lib/observability";

// SCP-02/ADR-0033/ADR-0034: the public signup endpoint. Enumeration-safe (AUT-05:
// identical response + timing whether or not the account exists), CAPTCHA-gated
// (ADR-0034), rate-limited (AUT-03), and password-strength gated (AUT-02). On a
// genuinely new email it provisions a tenant+admin and emails a verification link;
// on an existing email it sends an "you already have an account" email instead —
// same HTTP response either way.
const Input = z.object({
  email: z.email(),
  password: z.string().min(1),
  workspaceName: z.string().min(1).max(80),
  captchaToken: z.string().min(1),
  tosAccepted: z.literal(true),
});
const KIND = "signup";
const MIN_RESPONSE_MS = 700;

// The one response returned on BOTH the exists and not-exists paths (AUT-05).
const UNIFORM = {
  code: "signup_check_email",
  message: "If that email can be used, we've sent a link to finish signing up.",
};

export async function POST(request: Request) {
  if (!isSignupEnabled) {
    return jsonError("signup_disabled", "Signup is currently unavailable.", 403);
  }
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A valid email, password, and workspace name are required.", 400);

  const email = parsed.data.email.toLowerCase();
  const ip = clientIp(request);
  const now = Date.now();
  const origin = new URL(request.url).origin;
  const db = getDb();
  const attempts = new AuthAttemptsStore(db);

  // AUT-03: rate-limit signup attempts (uniform 429 like other throttled routes).
  const snap = await attempts.snapshot(email, ip, KIND, now, SIGNUP_THROTTLE);
  const throttle = evaluateThrottle(snap, now, SIGNUP_THROTTLE);
  if (!throttle.ok) {
    return NextResponse.json(
      { ...UNIFORM },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  // WP-SU-8: the GLOBAL ceiling. Both keys checked above are attacker-chosen — a fresh
  // email defeats the per-identifier limit, a rotated IP defeats the per-IP one — so this
  // is the only limit a distributed burst cannot rotate around. Checked BEFORE the CAPTCHA
  // and password work so a burst costs us one indexed count, not a Cloudflare round-trip
  // and an HIBP lookup each.
  const priorHour = await attempts.kindCount(KIND, now, SIGNUP_GLOBAL_CEILING.windowMs);
  const surge = evaluateSignupSurge(priorHour, SIGNUP_GLOBAL_CEILING, SIGNUP_SURGE_THRESHOLD);
  if (surge.alert) {
    // Deferred: alerting must never sit on the measured wire time (AUT-05) and must never
    // fail the request. notifyAuthAnomaly is already best-effort and self-logging.
    // The verdict reports a PERSISTENT condition, so the cooldown — not the count — is what
    // makes this one email per hour instead of one per refused request.
    const detail = surge.alert;
    const alertKey = surge.blocked ? "ceiling" : "surge";
    after(async () => {
      // See the notice callback below for why this is try/caught rather than trusting the
      // callees' never-throws contracts.
      try {
        if (await allowSignupAlert(db, alertKey, Date.now())) {
          await notifyAuthAnomaly(detail, "Security alert: unusual signup volume");
        }
      } catch (e) {
        logError("signup_surge_alert_failed", { message: e instanceof Error ? e.message : String(e) });
      }
    });
  }
  if (surge.blocked) {
    // AUT-05: the SAME uniform body and status as the per-identifier refusal above.
    return NextResponse.json(
      { ...UNIFORM },
      { status: 429, headers: { "Retry-After": String(SIGNUP_CEILING_RETRY_SEC) } },
    );
  }

  // ADR-0034: CAPTCHA verification is independent of whether the email exists —
  // safe to check outside the uniform-timing block.
  if (!(await verifyTurnstile(parsed.data.captchaToken, env.TURNSTILE_SECRET_KEY, ip ?? undefined))) {
    return jsonError("captcha_failed", "Verification failed. Please try again.", 400);
  }

  // AUT-02: strength + breach gate on the new password. Also independent of
  // whether the email exists.
  const evaluation = await evaluateNewPassword(parsed.data.password, [email, parsed.data.workspaceName], hibpRangeFetcher);
  if (!evaluation.ok) return jsonError("weak_password", evaluation.reasons.join(" "), 422);

  await withUniformTiming(
    MIN_RESPONSE_MS,
    async () => {
      await attempts.record(email, ip, KIND, false);
      const existing = await emailExistsGlobally(db, email);
      // WP-SU-1: the heavy, branch-specific work runs AFTER the response is sent, so its cost is
      // off the measured wire time. Both branches' in-request work is now the symmetric
      // record+lookup, which the uniform floor equalizes — no AUT-05 timing oracle.
      if (existing) {
        // notifyAlreadyRegistered is best-effort and self-logging (never throws) — no wrapper needed.
        // WP-SU-8: capped per RECIPIENT, because this mail goes to a third party the
        // requester merely named — the per-identifier signup limit is keyed on the victim's
        // own address, so it bounds the attacker at ~480 mails/day into that inbox.
        after(async () => {
          // try/catch even though both callees are fail-closed and self-logging: a throw
          // escaping an after() callback is console.error'd RAW by the framework, outside the
          // WP-SU-3 scrub seam, and a Drizzle error here carries the recipient's address as a
          // bound parameter. The provisioning callback below guards itself for the same reason.
          try {
            if (await allowAlreadyRegisteredMail(db, email, Date.now())) await notifyAlreadyRegistered(email);
          } catch (e) {
            logError("already_registered_notice_failed", { message: e instanceof Error ? e.message : String(e) });
          }
        });
        return;
      }
      after(async () => {
        try {
          const { userId } = await provisionSignup(getSupabaseAdmin(), db, {
            email,
            password: parsed.data.password,
            workspaceName: parsed.data.workspaceName,
          });
          const { token, record } = issueSignupToken(userId, Date.now());
          await new SignupStore(db).persist(record);
          await notifySignupVerify(email, `${origin}/signup/verify?token=${token}`);
        } catch (e) {
          if (e instanceof SignupEmailExistsError) {
            // WP-SU-8: the SAME per-recipient cap as the pre-check branch. This is the second
            // producer of the identical victim-directed mail, reached whenever
            // emailExistsGlobally says "new" but Supabase Auth says "exists" — the orphan
            // shape signup-sweep.ts documents as systematic, which persists up to the 24h
            // grace. Uncapped, it restored the full ~480/day mail-bomb for any address sitting
            // in that window, silently defeating the cap on the other branch.
            if (await allowAlreadyRegisteredMail(db, email, Date.now())) {
              await notifyAlreadyRegistered(email); // self-logging, never throws
            }
            return;
          }
          // SEC-05: log the failure (reaches Sentry, ADR-0032) without the password/token.
          logError("signup_provision_failed", { message: e instanceof Error ? e.message : String(e) });
        }
      });
    },
    (ms) => new Promise((r) => setTimeout(r, ms)),
    () => performance.now(),
  );
  return NextResponse.json({ ...UNIFORM });
}
