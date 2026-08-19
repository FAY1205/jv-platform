import { PartnersView } from "./partners-view";
import { partnerUuidParam } from "@/modules/leads/schema";

// N3C-04/C-56 — server shell: reads `?edit=<id>` (the partner-detail "Edit partner" deep
// link) and hands it to the client view as a prop. Deliberately NOT a
// useSearchParams()+Suspense client page — that construct froze hydration on this app's
// routes (Next 16); a server component prop is the boring, reliable path, and it is the
// pattern the sibling leads/page.tsx already follows.
//
// audit-tenancy F-5: the id is PARSED, not merely passed through. `?edit=` can only ever name
// a partner row, and `partnerUuidParam()` (modules/leads/schema, sharing UUID_RE with the
// `?partnerId=` parser) is that invariant expressed as code rather than as a comment —
// anything else becomes null and opens nothing. The value still only reaches an id comparison
// against the scoped roster the client already fetched, and every write the form then makes
// goes through the scoped API; enforcing the shape here is what survives the next edit.
export const dynamic = "force-dynamic";

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  const { edit } = await searchParams;
  return <PartnersView initialEditId={partnerUuidParam().parse(edit)} />;
}
