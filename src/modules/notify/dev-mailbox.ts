import type { EmailTransport, OutboundEmail } from "./email";

// ─────────────────────────────────────────────────────────────────────────────
// Dev-only "sent emails" mailbox. All non-production mail is redirected to the
// SEC-07 sink, so the owner can't receive partner OTP codes / invite / reset
// links in a real inbox. This process-wide store captures what the sink would
// have sent, and the non-prod, admin-gated /dev/emails page renders it so the
// owner can self-test onboarding, reset, and the partner portal end-to-end.
//
// SEC-07 stays intact: nothing here sends real mail — it only records what the
// sink captured. The reading surface exists ONLY in non-production (route +
// page hard-gate). Kept in memory (no schema): codes/links are short-lived and
// only meaningful within a running dev server; WP-028 adds the real outbox.
// ─────────────────────────────────────────────────────────────────────────────

export interface DevEmailEntry {
  seq: number;
  at: string; // ISO timestamp captured at record time
  outbound: OutboundEmail;
}

export interface DevEmailView {
  seq: number;
  at: string;
  kind: string;
  subject: string;
  /** The real intended recipient(s), preserved even though the sink took delivery. */
  intendedTo: string[];
  redirected: boolean;
  /** The 6-digit OTP code, surfaced only for OTP emails. */
  code: string | null;
  /** Any http(s) links in the body (invite/reset links). */
  links: string[];
  body: string;
}

// Cap so a long-lived dev server can't grow the buffer without bound.
const MAX_ENTRIES = 200;

interface DevMailboxState {
  entries: DevEmailEntry[];
  nextSeq: number;
}

// Stash on globalThis so a single dev server process shares one mailbox even if
// the module is evaluated in more than one bundle.
const GLOBAL_KEY = "__jv_dev_mailbox__";
function state(): DevMailboxState {
  const g = globalThis as unknown as Record<string, DevMailboxState | undefined>;
  return (g[GLOBAL_KEY] ??= { entries: [], nextSeq: 1 });
}

/** Record a captured (sink-redirected) email. Returns the stored entry. */
export function recordDevEmail(outbound: OutboundEmail, at?: string): DevEmailEntry {
  const s = state();
  const entry: DevEmailEntry = {
    seq: s.nextSeq++,
    at: at ?? new Date().toISOString(),
    outbound,
  };
  s.entries.push(entry);
  if (s.entries.length > MAX_ENTRIES) s.entries.splice(0, s.entries.length - MAX_ENTRIES);
  return entry;
}

/** Clear the mailbox (test isolation / a manual "clear" in the viewer). */
export function clearDevMailbox(): void {
  const s = state();
  s.entries = [];
  s.nextSeq = 1;
}

const LINK_RE = /https?:\/\/\S+/g;
const CODE_RE = /\b(\d{6})\b/;

function bodyOf(email: OutboundEmail): string {
  return email.text ?? email.html ?? "";
}

/** Pure projection of a stored entry to the UI-facing view. */
export function toDevEmailView(entry: DevEmailEntry): DevEmailView {
  const { outbound } = entry;
  const kind = outbound.meta?.kind ?? "email";
  const body = bodyOf(outbound);
  // Only OTP emails carry a real sign-in code; a reset token's digit runs are not
  // a code the owner should type, so never surface one for other kinds.
  const code = kind === "otp" ? (body.match(CODE_RE)?.[1] ?? null) : null;
  const links = [...body.matchAll(LINK_RE)].map((m) => m[0].replace(/[.,)]+$/, ""));
  return {
    seq: entry.seq,
    at: entry.at,
    kind,
    subject: outbound.subject,
    intendedTo: outbound.intendedTo,
    redirected: outbound.redirected,
    code,
    links,
    body,
  };
}

/** Newest-first projection of the captured mailbox, limited to `limit` entries. */
export function recentDevEmails(limit = 50): DevEmailView[] {
  const { entries } = state();
  const start = Math.max(0, entries.length - limit);
  return entries.slice(start).reverse().map(toDevEmailView);
}

/** Transport that records captured mail into the dev mailbox (the non-prod stand-in). */
export class DevMailboxTransport implements EmailTransport {
  async send(email: OutboundEmail): Promise<{ id: string }> {
    const entry = recordDevEmail(email);
    return { id: `dev-${entry.seq}` };
  }
}
