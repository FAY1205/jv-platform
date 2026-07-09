import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/app";
import { Providers } from "./providers";

// Typography (DSN-02): the app uses the native system UI font stack (wired in
// globals.css as --font-sans/-display/-mono) to match the approved mockup —
// no webfonts are loaded. Weight and tracking carry the display hierarchy.

export const metadata: Metadata = {
  title: `${APP_NAME} — JV Lead Matching Platform`,
  description:
    "Deterministic lead-routing for real-estate JV networks: parse, filter, match, dedupe, distribute.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
