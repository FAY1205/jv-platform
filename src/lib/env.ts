import { z } from "zod";
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

const EnvSchema = z.object({
  APP_ENV: AppEnvSchema.default("development"),
  APP_NAME: z.string().min(1).default(APP_NAME),
  DATABASE_URL: optionalString,
  SUPABASE_URL: optionalString.pipe(z.url().optional()),
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  RESEND_API_KEY: optionalString,
  // The verified sending identity used in production (NTF-03). Never used in
  // non-production — all dev/preview mail is intercepted to the sink (SEC-07).
  EMAIL_FROM: z.string().default("JV Platform <noreply@example.test>"),
  EMAIL_SINK_ADDRESS: z.email().default("dev-sink@example.test"),
  SENTRY_DSN: optionalString,
  ADMIN_ALLOWLIST: optionalString,
  // F-07: shared secret Vercel Cron presents as `Authorization: Bearer <CRON_SECRET>`.
  // The scheduled outbox drain refuses to run without it (a cron route must never be open).
  CRON_SECRET: optionalString,
});

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
    DATABASE_URL: source.DATABASE_URL,
    SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY: source.RESEND_API_KEY,
    EMAIL_FROM: source.EMAIL_FROM,
    EMAIL_SINK_ADDRESS: source.EMAIL_SINK_ADDRESS,
    SENTRY_DSN: source.SENTRY_DSN,
    ADMIN_ALLOWLIST: source.ADMIN_ALLOWLIST,
    CRON_SECRET: source.CRON_SECRET,
  });
}

export const env = readEnv();

export const isProduction = env.APP_ENV === "production";
export const isNonProduction = !isProduction;

/** Lowercased admin email allowlist (V1 has no admin self-signup — SCP-02). */
export const adminAllowlist: readonly string[] = (env.ADMIN_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
