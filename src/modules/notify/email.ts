import { env, isProduction, type AppEnv } from "@/lib/env";

// ─────────────────────────────────────────────────────────────────────────────
// Outbound email seam. SEC-07: in non-production environments, no real recipient
// may ever be emailed — every message is redirected to the sink address. The real
// Resend transport + outbox table (NTF-03) plug in behind EmailTransport in Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

export type EmailAddress = string;

export interface EmailMessage {
  to: EmailAddress | EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  /** Reference IDs / event linkage for the audit trail and outbox (SEAM-04). */
  meta?: Record<string, string>;
}

export interface OutboundEmail extends Omit<EmailMessage, "to"> {
  /** Recipients the transport will actually send to (sink in non-prod). */
  to: EmailAddress[];
  /** Original intended recipients, always preserved for the audit trail. */
  intendedTo: EmailAddress[];
  /** True when non-prod redirected the message away from real recipients. */
  redirected: boolean;
}

export interface GuardOptions {
  /** Override the environment (defaults to the running APP_ENV). */
  appEnv?: AppEnv;
  /** Override the sink address (defaults to env.EMAIL_SINK_ADDRESS). */
  sink?: EmailAddress;
}

/**
 * SEC-07 guardrail. Returns the message with recipients rewritten to the sink in
 * any non-production environment; production passes recipients through untouched.
 * The original recipients are retained in `intendedTo` for auditing.
 */
export function guardOutbound(msg: EmailMessage, opts: GuardOptions = {}): OutboundEmail {
  const intendedTo = Array.isArray(msg.to) ? [...msg.to] : [msg.to];
  const prod = opts.appEnv ? opts.appEnv === "production" : isProduction;

  if (prod) {
    return { ...msg, to: intendedTo, intendedTo, redirected: false };
  }
  const sink = opts.sink ?? env.EMAIL_SINK_ADDRESS;
  return { ...msg, to: [sink], intendedTo, redirected: true };
}

export interface EmailTransport {
  send(email: OutboundEmail): Promise<{ id: string }>;
}

/**
 * In-memory transport for local dev and tests. Records everything it "sends" so
 * SEC-07 behavior is assertable. Phase 2 adds a ResendTransport implementing the
 * same interface.
 */
export class MemoryTransport implements EmailTransport {
  public readonly sent: OutboundEmail[] = [];
  async send(email: OutboundEmail): Promise<{ id: string }> {
    this.sent.push(email);
    return { id: `mem-${this.sent.length}` };
  }
}

/** Send a message through a transport, applying the SEC-07 guard first. */
export async function sendEmail(
  msg: EmailMessage,
  transport: EmailTransport,
  opts: GuardOptions = {},
): Promise<{ id: string; redirected: boolean }> {
  const outbound = guardOutbound(msg, opts);
  const { id } = await transport.send(outbound);
  return { id, redirected: outbound.redirected };
}
