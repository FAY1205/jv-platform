import type { Metadata } from "next";
import { Card, CardBody, AuthCardHeader } from "@/components";
import { APP_NAME } from "@/lib/app";
import { NOTIFICATION_EVENTS } from "@/modules/notify/prefs";
import { UnsubscribeConfirm } from "./unsubscribe-confirm";

// NTF-13: the PUBLIC unsubscribe landing page an email footer link points at.
//
// Public by ABSENCE from PROTECTED_PAGE_PREFIXES in src/proxy.ts (that list is an allowlist of
// protected prefixes) — the same way /terms is public. It must be: the person clicking arrives
// from a mail client with no session, and a redirect to /login would make the control useless.
//
// GET NEVER APPLIES ANYTHING. Mail scanners, security gateways and link-preview crawlers fetch
// URLs out of messages; a GET that wrote would silently unsubscribe people who never clicked. So
// this renders a confirm card and the write happens on the button's POST.
//
// The page is deliberately incurious: it does not look the token up, so it can neither confirm
// that a link is valid nor show whose address it belongs to (AUT-05). It renders the same card
// for every token, valid or not.

export const metadata: Metadata = {
  title: `Unsubscribe — ${APP_NAME}`,
  description: "Turn off notification emails from the platform.",
  // A capability link must never reach a search index or a referrer log.
  robots: { index: false, follow: false },
};

/** The catalog label for an event key, for the confirm sentence. Keys are shared across the two
 *  role buckets (`hot_leads`, `task_due`), and the page has no session to tell it which bucket
 *  the reader is in — the first match is the right English either way. Unknown or absent key ⇒
 *  the "all emails" copy, which is also what the endpoint does with it. */
function describeEvent(event: string | undefined): string | null {
  if (!event || event === "all") return null;
  return NOTIFICATION_EVENTS.find((e) => e.key === event)?.label ?? null;
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; event?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const event = typeof params.event === "string" ? params.event : "all";
  const label = describeEvent(event);

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardBody>
          {/* The shared identity block every public card carries (C-63): someone arriving from an
              email needs to know WHOSE notifications these are before switching them off. */}
          <AuthCardHeader title="Unsubscribe" />
          {token === "" ? (
            <p className="text-sm leading-relaxed text-text-2">
              This link is incomplete. Open the unsubscribe link from the bottom of the email again, or change your
              preferences from your account.
            </p>
          ) : (
            <UnsubscribeConfirm
              token={token}
              event={event}
              label={
                label
                  ? `Stop sending emails for "${label}"? Your in-app notifications are not affected.`
                  : "Stop sending all notification emails to this address? Your in-app notifications are not affected, and account emails such as password resets will still be sent."
              }
            />
          )}
        </CardBody>
      </Card>
    </main>
  );
}
