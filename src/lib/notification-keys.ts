// The two TanStack Query keys the notification feed is cached under (NTF-04 / NTF-12).
//
// They are DELIBERATELY different shapes of the same data and must not share a key:
//   • NOTIFICATIONS_FEED_KEY  — the bell's FLAT `{ notifications, unread }` page.
//   • NOTIFICATIONS_PAGE_KEY  — the /notifications page's INFINITE `{ pages, pageParams }`.
// One key for both would have `setQueryData` on either surface write a structure the other
// cannot read (`data.notifications` vs `data.pages`), which is a runtime crash, not a stale
// number.
//
// NOTIFICATIONS_PAGE_KEY is a PREFIX EXTENSION of the bell's key on purpose: TanStack's
// `invalidateQueries` matches by prefix, so invalidating `["notifications"]` reaches both
// caches and the bell badge can never disagree with the page after a mark-read. Both call
// sites still name both keys explicitly — the coupling is intentional, but relying on it
// silently would be a trap for whoever renames one of them.

export const NOTIFICATIONS_FEED_KEY = ["notifications"] as const;
export const NOTIFICATIONS_PAGE_KEY = ["notifications", "feed"] as const;
