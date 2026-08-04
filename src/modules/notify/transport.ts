import type { EmailTransport } from "./email";
import { DevMailboxTransport } from "./dev-mailbox";
import { ResendTransport } from "./resend";

// NTF-03 / SEC-07: the single decision of "which transport actually sends this email".
// Both the instant auth path (src/lib/auth/notify.ts) and the batched outbox
// (src/modules/notify/outbox.ts) call this, so "send for real" is defined once and
// cannot drift between them.
//
// SEC-07 is enforced HERE: the Resend transport is returned ONLY in production. Every
// non-production environment gets the dev mailbox, so dev/preview/CI can never reach a
// real recipient — no key, misconfiguration, or call site can bypass that. Pure and
// injectable (env is passed in, not read) so the guarantee is directly unit-testable.
export interface EmailTransportEnv {
  isProduction: boolean;
  resendKey: string | undefined;
  emailFrom: string;
}

export function resolveEmailTransport(env: EmailTransportEnv): EmailTransport {
  if (env.isProduction && env.resendKey) return new ResendTransport(env.resendKey, env.emailFrom);
  return new DevMailboxTransport();
}
