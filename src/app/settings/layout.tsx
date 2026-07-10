import * as React from "react";
import { AppShell, ToastProvider } from "@/components";
import { SettingsNav } from "./settings-nav";

// WS-7: the Settings hub. One AppShell + ToastProvider + left sub-nav wraps every
// /settings/* section, so section pages render only their own content.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <ToastProvider>
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Settings</h1>
            <p className="mt-1 text-sm text-text-2">Manage your account, workspace, and how the app behaves.</p>
          </div>
          <div className="grid gap-8 lg:grid-cols-[210px_1fr]">
            <SettingsNav />
            <div className="min-w-0 max-w-[760px]">{children}</div>
          </div>
        </div>
      </ToastProvider>
    </AppShell>
  );
}
