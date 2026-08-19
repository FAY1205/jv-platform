import { getDb } from "@/db";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { applyUnsubscribe, UnsubscribeRequestSchema } from "@/modules/notify/unsubscribe";

// POST /api/unsubscribe — NTF-13. The ONE write behind an email footer link.
//
// NO SESSION and NO CSRF TOKEN, by design. A recipient clicking "unsubscribe" in a mail
// client is, definitionally, not signed in — requiring a session would send them to /login
// and make the control unusable for the people who most want it. The bearer token in the body
// IS the capability: it is unguessable (16B id + 32B secret), it is scoped to exactly one
// subject, and the only thing it can do is REDUCE that subject's email. A CSRF token would
// add nothing — an attacker who can forge this request already has the victim's token, and
// with it could simply call the endpoint directly.
//
// AUT-05: every outcome — valid token, wrong secret, malformed token, unknown event, subject
// long gone — returns the SAME body and status, and the response never echoes an address.
// The uniform TIMING lives in applyUnsubscribe (the constant dummy compare).
const GENERIC_SUCCESS = {
  code: "ok",
  message: "If that link was still valid, those emails are switched off. It can take a few minutes to take effect.",
};

export async function POST(request: Request) {
  try {
    const parsed = UnsubscribeRequestSchema.safeParse(await request.json().catch(() => null));
    // A body missing the fields entirely carries no token, so it is not an existence oracle —
    // it is a malformed call, and says so. Anything that IS a well-formed {token, event} pair
    // goes down the single uniform path below, whatever the strings contain.
    if (!parsed.success) return jsonError("invalid_input", "Invalid unsubscribe request.", 400);
    await applyUnsubscribe(getDb(), parsed.data);
    return jsonOk(GENERIC_SUCCESS);
  } catch (e) {
    // SEC-05: the detail carries the error message only — never the token or an address.
    return jsonServerError("unsubscribe_failed", "Could not process that request.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
