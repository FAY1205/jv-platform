import type { EmailTransport, OutboundEmail } from "./email";

// ─────────────────────────────────────────────────────────────────────────────
// Resend transport (NTF-03), behind the shared EmailTransport seam. Uses the
// Resend REST API via fetch — no SDK dependency (ADR-0011). Constructed ONLY in
// production, via the shared resolveEmailTransport (src/modules/notify/transport.ts) —
// both the instant auth path and the outbox delegate there; non-production always uses
// the dev mailbox so SEC-07 holds and no real recipient can be reached from dev/preview.
// ─────────────────────────────────────────────────────────────────────────────

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class ResendTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    if (!apiKey) throw new Error("ResendTransport requires an API key.");
  }

  async send(email: OutboundEmail): Promise<{ id: string }> {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: email.to,
        subject: email.subject,
        ...(email.text ? { text: email.text } : {}),
        ...(email.html ? { html: email.html } : {}),
      }),
    });
    if (!res.ok) {
      // SEC-05 + ADR-0032: this error propagates to logError → Sentry (a third party), and
      // Resend's response body can echo the recipient's email address. Surface only the
      // status code — enough to diagnose the common cases (403 domain unverified, 422
      // validation, 429 rate limit) without leaking a recipient to the observability tool.
      throw new Error(`Resend send failed (${res.status})`);
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: json.id ?? "resend-unknown" };
  }
}
