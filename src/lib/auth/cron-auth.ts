import { timingSafeEqualStr } from "./constant-time";

// F-07: authorize a scheduled (Vercel Cron) request. Vercel presents the project's
// CRON_SECRET as `Authorization: Bearer <secret>`. Comparison is constant-time (AUT-09).
// Deny when the secret is unconfigured or the header is absent/mismatched — a cron
// endpoint that runs cross-tenant work must never be open.

const BEARER = "Bearer ";

export function isAuthorizedCron(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  if (!authHeader || !authHeader.startsWith(BEARER)) return false;
  return timingSafeEqualStr(authHeader.slice(BEARER.length), secret);
}
