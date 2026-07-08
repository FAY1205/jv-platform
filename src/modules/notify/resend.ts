import type { EmailTransport, OutboundEmail } from "./email";

// ─────────────────────────────────────────────────────────────────────────────
// Resend transport (NTF-03), behind the shared EmailTransport seam. Uses the
// Resend REST API via fetch — no SDK dependency (ADR-0011). Constructed ONLY in
// production (see resolveOutboxTransport); non-production always uses the dev
// mailbox so SEC-07 holds and no real recipient can be reached from dev/preview.
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
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend send failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: json.id ?? "resend-unknown" };
  }
}
