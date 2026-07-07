// Application-layer auth hardening (spec §6.18 "delegation boundary"). Supabase Auth
// supplies the primitives (hashing, email OTP, refresh rotation); these modules add
// the responsibilities built on top. Route wiring lands with the portal (Phase 2).
export { timingSafeEqualStr } from "./constant-time";
export { sha256Hex } from "./hash";
export {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  clearSessionCookie,
  serializeCookie,
  type CookieAttributes,
} from "./cookies";
export {
  UNIFORM_AUTH_MESSAGE,
  uniformAuthResponse,
  withUniformTiming,
  type UniformAuthResponse,
} from "./enumeration";
export { lockoutState, type LockoutState } from "./lockout";
export { generateOtp, hashOtp, issueOtp, verifyOtp, OTP_TTL_MS, type OtpChallenge } from "./otp";
export {
  MIN_PASSWORD_LENGTH,
  MIN_ZXCVBN_SCORE,
  checkPasswordStrength,
  isPasswordBreached,
  hibpRangeFetcher,
  type PasswordStrength,
  type RangeFetcher,
} from "./password";
export {
  RESET_TTL_MS,
  issueResetToken,
  verifyResetToken,
  type ResetTokenRecord,
  type ResetVerifyReason,
} from "./reset-token";
export {
  REFRESH_ABSOLUTE_MS,
  InMemoryRefreshStore,
  RefreshTokenService,
  type RefreshRecord,
  type RefreshStore,
  type RotateResult,
} from "./refresh";
