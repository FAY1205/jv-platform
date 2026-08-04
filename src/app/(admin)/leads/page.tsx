import { LeadsView } from "./leads-view";

// Server shell: reads ?q= (the topbar search handoff) and hands it to the client
// view as a prop. Deliberately NOT a useSearchParams()+Suspense client page —
// that construct froze hydration on this route (Next 16); a server component
// prop is the boring, reliable path.
export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; open?: string | string[]; hot?: string | string[] }>;
}) {
  const { q, open, hot } = await searchParams;
  // ?open=<ref> deep-links a single lead straight into the dialog (P-1: the
  // status-change notification and AI citations land here, not the retired page).
  // ?hot=1 opens the list pre-filtered to hot leads (the hot-lead alert deep link).
  return (
    <LeadsView
      initialQ={typeof q === "string" ? q : ""}
      initialOpenRef={typeof open === "string" ? open : null}
      initialHot={hot === "1" || hot === "true"}
    />
  );
}
