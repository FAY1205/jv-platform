import { notFound } from "next/navigation";
import { isProduction } from "@/lib/env";
import { EmailsView } from "./emails-view";

// SEC-07 / F-48: the dev email viewer must not exist in production. The API already
// 404s there; this 404s the page too (a server component guard runs before render).
export default function DevEmailsPage() {
  if (isProduction) notFound();
  return <EmailsView />;
}
