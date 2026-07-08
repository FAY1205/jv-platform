import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { jsonOk, jsonError } from "@/lib/http";

// ACC-02: the authenticated user's active trusted devices (remembered browsers).
export async function GET() {
  try {
    const scope = await getServerScope();
    const devices = await new TrustedDeviceService(getDb()).listForUser(scope.userId, Date.now());
    return jsonOk({ devices });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("sessions_failed", "Could not load devices.", 500);
  }
}
