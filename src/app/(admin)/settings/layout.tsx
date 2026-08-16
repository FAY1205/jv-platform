import * as React from "react";
import { AppShell, PageContainer } from "@/components";
import { getServerScope } from "@/lib/scope-context";
import { isCallerPlatformOwner } from "@/lib/auth/platform-owner";
import { SettingsNav } from "./settings-nav";
import { SettingsHeader } from "./settings-header";

// WS-7: the Settings hub. One AppShell + left sub-nav wraps every /settings/* section.
// The "Settings" title lives in the topbar (SettingsHeader); each section renders its own
// SettingsSection header. Toast comes from AppShell (ADR-0030).
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // SCP-07: resolve platform-ownership server-side so the nav can reveal the owner-only
  // Invitations link without a client fetch. Best-effort — the layout must still render
  // if scope can't resolve (the page/route enforce auth).
  const scope = await getServerScope().catch(() => null);
  const isPlatformOwner = scope ? await isCallerPlatformOwner(scope).catch(() => false) : false;
  return (
    <AppShell>
      <SettingsHeader />
      {/* WP-UX-2: the nav + content ensemble centers as one `hub` unit instead of
          hugging the left with all the slack in one right gutter (audit S-2/T2);
          content width moves off the ad-hoc 760px literal onto the prose token. */}
      <PageContainer size="hub">
        <div className="grid gap-8 lg:grid-cols-[210px_1fr]">
          <SettingsNav isPlatformOwner={isPlatformOwner} />
          <div className="min-w-0 max-w-3xl">{children}</div>
        </div>
      </PageContainer>
    </AppShell>
  );
}
