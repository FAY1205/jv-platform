import { redirect } from "next/navigation";
import { getServerScope } from "@/lib/scope-context";
import { isPartnerStream } from "@/lib/scope";

// Root: send people where they belong — signed-out visitors to the login screen,
// admins to their runs, partners to their portal. Computed inside try/catch, then
// redirect() is called OUTSIDE it (redirect throws internally — catching it here
// would swallow the navigation).
export const dynamic = "force-dynamic";

export default async function Home() {
  let target = "/login";
  try {
    const scope = await getServerScope();
    target = isPartnerStream(scope) ? "/portal/dashboard" : "/dashboard";
  } catch {
    target = "/login";
  }
  redirect(target);
}
