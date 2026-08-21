import { LeadsView } from "./leads-view";
import { tagsParam } from "@/modules/tags/schema";
import { partnerIdParam } from "@/modules/leads/schema";
import { savedViewIdParam } from "@/modules/saved-views/schema";

// Server shell: reads ?q= (the topbar search handoff) and hands it to the client
// view as a prop. Deliberately NOT a useSearchParams()+Suspense client page —
// that construct froze hydration on this route (Next 16); a server component
// prop is the boring, reliable path.
export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    open?: string | string[];
    hot?: string | string[];
    tags?: string | string[];
    partnerId?: string | string[];
    view?: string | string[];
  }>;
}) {
  const { q, open, hot, tags, partnerId, view } = await searchParams;
  // ?open=<ref> deep-links a single lead straight into the dialog (P-1: the
  // status-change notification and AI citations land here, not the retired page).
  // ?hot=1 opens the list pre-filtered to hot leads (the hot-lead alert deep link).
  // UXF-11.1: ?tags=<csv of tag ids> opens the list pre-filtered to those tags (Settings →
  // Tags usage counts link here). Parsed by the SAME `tagsParam()` the two leads endpoints
  // embed, so the page and the API can never disagree about what `?tags=` means — and a
  // crafted URL degrades to "no tag filter" rather than erroring (TAG-03).
  // N3C-05/C-69: ?partnerId=<id> opens the list pre-filtered to one partner (the partner
  // detail page's "View all in Leads →"). Parsed by the SAME `partnerIdParam()` the two leads
  // endpoints embed, so the page and the API can never disagree about what `?partnerId=`
  // means — and a crafted value degrades to "no partner filter" rather than erroring.
  // N6-72: ?view=<saved view id> opens the list with that view applied (the Ctrl-K palette's
  // "Apply view" from a page other than this one). Shape-parsed here; the id is matched against
  // the user's OWN saved-view roster client-side, so an unknown or foreign one is a no-op.
  return (
    <LeadsView
      initialQ={typeof q === "string" ? q : ""}
      initialOpenRef={typeof open === "string" ? open : null}
      initialHot={hot === "1" || hot === "true"}
      initialTags={tagsParam().parse(tags)}
      initialPartnerId={partnerIdParam().parse(partnerId) ?? ""}
      initialViewId={savedViewIdParam().parse(view)}
    />
  );
}
