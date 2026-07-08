import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { listNotifications, unreadCount } from "@/modules/notify/notifications";
import { jsonOk, jsonError } from "@/lib/http";

// NTF-04: the signed-in user's in-app notifications + unread count (both roles).
export async function GET() {
  try {
    const scope = await getServerScope();
    const [notifications, unread] = await Promise.all([listNotifications(scope), unreadCount(scope)]);
    return jsonOk({ notifications, unread });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("notifications_failed", "Could not load notifications.", 500);
  }
}
