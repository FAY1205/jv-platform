const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// ADR-0034: verify a Turnstile token server-side. Fail closed — any missing input,
// non-2xx, success:false, or network error returns false. The secret is never logged.
export async function verifyTurnstile(
  token: string | undefined,
  secret: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(SITEVERIFY, { method: "POST", body });
    if (!res.ok) return false;
    const json = (await res.json().catch(() => ({}))) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
