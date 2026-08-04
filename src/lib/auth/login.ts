// AUT-05: admin password login. The route makes a single sign-in attempt and maps
// only success/failure to a response — there is deliberately no account-existence
// branch, so a wrong password and a nonexistent account are indistinguishable to
// the client. Timing is floored separately (withUniformTiming) at the route.

export const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

export interface LoginOutcome {
  status: number;
  code: string;
  message: string;
}

/** Map the boolean result of a single sign-in attempt to the client response. */
export function loginOutcome(success: boolean): LoginOutcome {
  return success
    ? { status: 200, code: "ok", message: "Signed in." }
    : { status: 401, code: "auth_invalid_credentials", message: INVALID_CREDENTIALS_MESSAGE };
}
