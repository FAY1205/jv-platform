import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle, PasswordChangeForm } from "@/components";

// Standalone change-password page (kept working for direct links / partner flows). Admins
// also reach the same form under Settings → Profile (WS-7). The form + server gate
// (AUT-01/02/08) live in the shared PasswordChangeForm component.
export default function ChangePasswordPage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardBody>
          <PasswordChangeForm />
          <div className="mt-4">
            <Link href="/dashboard" className="text-sm text-brand hover:underline">
              ← Back to dashboard
            </Link>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
