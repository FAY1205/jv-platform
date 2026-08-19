import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { FEED_PAGE_MAX, listNotifications, unreadCount } from "@/modules/notify/notifications";
import { CURSOR_MAX_LENGTH, decodeNotificationCursor } from "@/modules/notify/feed-cursor";
import { jsonOk, jsonError } from "@/lib/http";

// NTF-04: the signed-in user's in-app notifications + unread count (both roles).
//
// FEP-03 / NTF-12: optionally keyset-paginated with `?cursor=&limit=`. Both are OPTIONAL and
// the bare call is unchanged — the bell keeps calling `/api/notifications` with no query and
// gets the same 30 newest rows it always did, now with an additive `nextCursor` it ignores.
// The /notifications page walks the same endpoint with `useInfiniteQuery`.
const FeedQuerySchema = z.object({
  cursor: z.string().min(1).max(CURSOR_MAX_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(FEED_PAGE_MAX).optional(),
});

export async function GET(request: Request) {
  try {
    // Scope FIRST: an unauthenticated call is a 401, never a 400 about its query string.
    const scope = await getServerScope();
    const parsed = FeedQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return jsonError("invalid_input", "Invalid notifications query.", 400);
    const rawCursor = parsed.data.cursor;
    // A malformed cursor is REFUSED rather than ignored: silently serving page one would read
    // to a paging client as "the feed ended, then started over" and quietly duplicate rows.
    const cursor = rawCursor ? decodeNotificationCursor(rawCursor) : null;
    if (rawCursor && !cursor) return jsonError("invalid_input", "Invalid notifications cursor.", 400);

    const [page, unread] = await Promise.all([
      listNotifications(scope, { limit: parsed.data.limit, cursor }),
      unreadCount(scope),
    ]);
    // `unread` is the whole-feed count on EVERY page (PRN-15: one server-computed number),
    // so a later page never disagrees with the badge.
    return jsonOk({ notifications: page.notifications, unread, nextCursor: page.nextCursor });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("notifications_failed", "Could not load notifications.", 500);
  }
}
