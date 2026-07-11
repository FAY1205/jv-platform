import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/app";
import { Providers } from "./providers";

// Typography (DSN-02, ADR-0022): the "Survey" three-role pairing, loaded via
// next/font/google (no new deps) and exposed as CSS variables that globals.css
// maps onto --font-display/-sans/-mono. Fraunces = display (engraved map-plate
// titles + headline numbers), Hanken Grotesk = body/UI, IBM Plex Mono = the
// "cartographic coordinate" numerics (ref-IDs, counts).
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  fallback: ["ui-serif", "Iowan Old Style", "Palatino Linotype", "Georgia", "serif"],
});
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hanken",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
  fallback: ["SF Mono", "Cascadia Code", "ui-monospace", "Roboto Mono", "monospace"],
});

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
    <html
      lang="en"
      className={`h-full antialiased ${fraunces.variable} ${hanken.variable} ${plexMono.variable}`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
