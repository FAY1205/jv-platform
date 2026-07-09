import { LeadsView } from "./leads-view";

// Server shell: reads ?q= (the topbar search handoff) and hands it to the client
// view as a prop. Deliberately NOT a useSearchParams()+Suspense client page —
// that construct froze hydration on this route (Next 16); a server component
// prop is the boring, reliable path.
export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  return <LeadsView initialQ={typeof q === "string" ? q : ""} />;
}
