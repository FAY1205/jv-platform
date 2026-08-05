import { z } from "zod";
import { scrubString } from "@/lib/scrub";
import { APP_NAME } from "@/lib/app";

// ─────────────────────────────────────────────────────────────────────────────
// Typed, validated environment (SEC-07, API-01 boundary pattern).
// APP_ENV drives the environment-separation guardrails: non-production must use
// separate Supabase projects and an email sink — code must never be able to email
// real partners from dev/preview.
// ─────────────────────────────────────────────────────────────────────────────

export const AppEnvSchema = z.enum(["development", "preview", "production"]);
export type AppEnv = z.infer<typeof AppEnvSchema>;

// Treat empty strings (common in .env files) as "unset" so optional URL/email
// validators don't fail on a blank value.
const optionalString = z
  .string()
  .transform((v) => (v.trim() === "" ? undefined : v))
  .optional();

// The dev/preview placeholder sender. Production must override it (see the refine below):
// Resend rejects sends from an unverified example.test domain, so leaving it here would
// make every OTP/invite/reset silently fail per-send. Named so default + guard can't drift.
const DEFAULT_EMAIL_FROM = `${APP_NAME} <noreply@example.test>`;

const EnvSchema = z.object({
  APP_ENV: AppEnvSchema.default("development"),
  APP_NAME: z.string().min(1).default(APP_NAME),
  // Canonical app base URL for links built OUTSIDE a web request (the release cron's digest emails).
  // Request-served paths still use the request origin; set this to the production URL at go-live.
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: optionalString,
  SUPABASE_URL: optionalString.pipe(z.url().optional()),
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  RESEND_API_KEY: optionalString,
  // The verified sending identity used in production (NTF-03). Never used in
  // non-production — all dev/preview mail is intercepted to the sink (SEC-07).
  // Empty or unset both collapse to the placeholder, so the production refine below catches
  // a blank EMAIL_FROM the same as a missing one (a blank sender is just as broken).
  EMAIL_FROM: z
    .string()
    .default(DEFAULT_EMAIL_FROM)
    .transform((v) => (v.trim() === "" ? DEFAULT_EMAIL_FROM : v)),
  EMAIL_SINK_ADDRESS: z.email().default("dev-sink@example.test"),
  SENTRY_DSN: optionalString,
  // ADR-0034: Cloudflare Turnstile — signup bot protection. SITE_KEY is public (client
  // widget); SECRET_KEY is server-only and required in production (refine below).
  TURNSTILE_SITE_KEY: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,
  ADMIN_ALLOWLIST: optionalString,
  // F-07: shared secret Vercel Cron presents as `Authorization: Bearer <CRON_SECRET>`.
  // The scheduled outbox drain refuses to run without it (a cron route must never be open).
  // SEC-05 (WP-SU-3): constrained so it is REDACTABLE BY CONSTRUCTION. The log scrubber
  // redacts long opaque runs but deliberately preserves UUIDs (traceId/tenantId
  // correlation), so a UUID-shaped secret — a very common ops habit — would survive into
  // logs, as would a short passphrase with punctuation (it fragments below the threshold).
  // 32+ chars from the base64url alphabet is exactly what the scrubber always catches.
  // The charset alone is not enough: base64url legitimately contains `-`, so a UUID is
  // also 36 "valid" chars — it must be excluded by shape, not by alphabet.
  // Validated BY the scrubber, not by a restatement of its rules — the two drifted once
  // already (a passphrase-shaped secret satisfies the charset rule but the scrubber treats
  // it as a structured identifier and leaves it in clear).
  CRON_SECRET: optionalString.refine((v) => v == null || (v.length >= 32 && scrubString(v) === "[redacted-token]"), {
    message:
      "CRON_SECRET must be 32+ chars that the log scrubber fully redacts (base64url-style; not a UUID, not a passphrase).",
  }),
  // ADR-0034: public signup kill-switch. Unset ⇒ default (OFF in production, ON elsewhere).
  SIGNUP_ENABLED: z.enum(["true", "false"]).optional(),
  // ADR-0027: Vercel AI Gateway key (default provider) and the data-terms tier
  // guard. LGL-04: Gemini's FREE tier trains on submitted content, so "free-dev"
  // is only lawful against dev's synthetic data (SEC-07); the chat route
  // hard-refuses in production unless AI_TIER=paid.
  AI_GATEWAY_API_KEY: optionalString,
  AI_TIER: z.enum(["paid", "free-dev"]).default("free-dev"),
  // ADR-0027 amendment: runtime model provider. "gateway" (default) routes the
  // model string through the Vercel AI Gateway (zero-retention, LGL-04-clean).
  // "google" calls Google's Generative Language API directly — a DEV-only path
  // for vetting on Google's free tier against synthetic data; production is still
  // blocked from the free tier by the AI_TIER=paid gate regardless of provider.
  AI_PROVIDER: z.enum(["gateway", "google"]).default("gateway"),
  // Google AI Studio API key (AIza…) — only read when AI_PROVIDER=google.
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  // ADR-0036: master key for AES-256-GCM encryption of per-tenant AI provider
  // credentials at rest (32 bytes, base64). Optional — when absent, the BYO-key
  // feature is disabled with a clear message rather than crashing boot.
  AI_KEY_ENCRYPTION_KEY: optionalString,
}).refine(
  // Fail fast in production if APP_URL is still the localhost default — otherwise the release cron
  // would email real partners digest links pointing at localhost (audit-api-contract F-2).
  (v) => v.APP_ENV !== "production" || v.APP_URL !== "http://localhost:3000",
  { message: "APP_URL must be set to the production origin (release-cron digest links).", path: ["APP_URL"] },
).refine(
  // NTF-03: production sends transactional email (OTP/invite/reset) for real via Resend. Without a
  // key the transport falls back to the dev mailbox, which is 404'd in production — so every code
  // is silently black-holed. Fail loud at boot instead (mirrors the APP_URL guard).
  (v) => v.APP_ENV !== "production" || !!v.RESEND_API_KEY,
  { message: "RESEND_API_KEY is required in production (transactional email delivery).", path: ["RESEND_API_KEY"] },
).refine(
  // NTF-03: Resend rejects sends from an unverified domain, so a placeholder EMAIL_FROM makes every
  // production email fail per-send (best-effort, no boot error). Require a real verified sender.
  (v) => v.APP_ENV !== "production" || v.EMAIL_FROM !== DEFAULT_EMAIL_FROM,
  { message: "EMAIL_FROM must be a verified sender on your domain in production.", path: ["EMAIL_FROM"] },
).refine(
  // ADR-0034: public signup must never ship without server-side CAPTCHA verification.
  (v) => v.APP_ENV !== "production" || !!v.TURNSTILE_SECRET_KEY,
  { message: "TURNSTILE_SECRET_KEY is required in production (signup bot protection).", path: ["TURNSTILE_SECRET_KEY"] },
).refine(
  // ADR-0034: the public Turnstile SITE key must be present in production or the widget never
  // renders and signup is unusable (mirrors the SECRET_KEY guard).
  (v) => v.APP_ENV !== "production" || !!v.TURNSTILE_SITE_KEY,
  { message: "TURNSTILE_SITE_KEY is required in production (signup CAPTCHA widget).", path: ["TURNSTILE_SITE_KEY"] },
);

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parse an environment source into typed config. Exported (rather than only the
 * singleton) so tests can validate behavior against an explicit source without
 * mutating process.env.
 */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  return EnvSchema.parse({
    APP_ENV: source.APP_ENV,
    // NEXT_PUBLIC_ prefix is required for client exposure; internal name is APP_NAME.
    APP_NAME: source.NEXT_PUBLIC_APP_NAME,
    APP_URL: source.APP_URL,
    DATABASE_URL: source.DATABASE_URL,
    SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY: source.RESEND_API_KEY,
    EMAIL_FROM: source.EMAIL_FROM,
    EMAIL_SINK_ADDRESS: source.EMAIL_SINK_ADDRESS,
    SENTRY_DSN: source.SENTRY_DSN,
    TURNSTILE_SITE_KEY: source.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: source.TURNSTILE_SECRET_KEY,
    ADMIN_ALLOWLIST: source.ADMIN_ALLOWLIST,
    CRON_SECRET: source.CRON_SECRET,
    SIGNUP_ENABLED: source.SIGNUP_ENABLED,
    AI_GATEWAY_API_KEY: source.AI_GATEWAY_API_KEY,
    AI_TIER: source.AI_TIER,
    AI_PROVIDER: source.AI_PROVIDER,
    GOOGLE_GENERATIVE_AI_API_KEY: source.GOOGLE_GENERATIVE_AI_API_KEY,
    AI_KEY_ENCRYPTION_KEY: source.AI_KEY_ENCRYPTION_KEY,
  });
}

export const env = readEnv();

export const isProduction = env.APP_ENV === "production";

// Public signup is OFF by default in production (compliance kill-switch — flip on only after
// ToS/Privacy + subprocessor page are ready) and ON by default in non-production for testing.
export const isSignupEnabled = env.SIGNUP_ENABLED != null ? env.SIGNUP_ENABLED === "true" : !isProduction;

/** Lowercased admin email allowlist (V1 has no admin self-signup — SCP-02). */
export const adminAllowlist: readonly string[] = (env.ADMIN_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
