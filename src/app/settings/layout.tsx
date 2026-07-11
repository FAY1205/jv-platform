import * as React from "react";
import { AppShell, ToastProvider } from "@/components";
import { SettingsNav } from "./settings-nav";
import { SettingsHeader } from "./settings-header";

// WS-7: the Settings hub. One AppShell + ToastProvider + left sub-nav wraps every
// /settings/* section. The "Settings" title lives in the topbar (SettingsHeader); each
// section renders its own SettingsSection header.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <ToastProvider>
        <SettingsHeader />
        <div className="grid gap-8 lg:grid-cols-[210px_1fr]">
          <SettingsNav />
          <div className="min-w-0 max-w-[760px]">{children}</div>
        </div>
      </ToastProvider>
    </AppShell>
  );
}
