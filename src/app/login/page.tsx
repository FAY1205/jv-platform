import { Suspense } from "react";
import type { Metadata } from "next";
import { isSignupEnabled } from "@/lib/env";
import { APP_NAME } from "@/lib/app";
import { LoginForm } from "./login-form";

// Distinct tab title so a partner who lands here can tell admin from partner sign-in.
export const metadata: Metadata = { title: `Admin portal sign-in — ${APP_NAME}` };

// Server component: reads isSignupEnabled (server-only env) and passes it to the client form, so
// the "Sign up" link is shown only when public signup is enabled. Suspense boundary is required
// because LoginForm reads useSearchParams (the `?next=` return path).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm signupEnabled={isSignupEnabled} />
    </Suspense>
  );
}
