import { Suspense } from "react";
import { isSignupEnabled } from "@/lib/env";
import { LoginForm } from "./login-form";

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
