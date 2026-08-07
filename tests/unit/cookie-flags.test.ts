import { describe, it, expect } from "vitest";
import {
  AUTH_COOKIE_OPTIONS,
  TRUST_COOKIE_OPTIONS,
  TRUST_COOKIE_NAME,
} from "@/lib/supabase/cookie-options";

// TST-12 / AUT-12 (audit R-14): the spec's "cookie flags asserted" sub-requirement had no
// live test. A regression dropping HttpOnly or Secure (session hijack / XSS token theft),
// or the __Host- prefix (subdomain cookie fixation), would previously pass every test.
describe("AUT-12 / TST-12: auth cookie flags", () => {
  it("AUT-12: session cookie is HttpOnly + Secure + SameSite=Lax with a __Host- name", () => {
    expect(AUTH_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(AUTH_COOKIE_OPTIONS.secure).toBe(true);
    expect(AUTH_COOKIE_OPTIONS.sameSite).toBe("lax");
    expect(AUTH_COOKIE_OPTIONS.name).toBe("__Host-jv-auth");
    expect(AUTH_COOKIE_OPTIONS.name?.startsWith("__Host-")).toBe(true);
  });

  it("AUT-12: trusted-device cookie is HttpOnly + Secure + SameSite=Lax with a __Host- name", () => {
    expect(TRUST_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(TRUST_COOKIE_OPTIONS.secure).toBe(true);
    expect(TRUST_COOKIE_OPTIONS.sameSite).toBe("lax");
    expect(TRUST_COOKIE_NAME).toBe("__Host-jv-trust");
    expect(TRUST_COOKIE_NAME.startsWith("__Host-")).toBe(true);
  });
});
