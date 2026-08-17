import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

// C-29 (ADR-0046 Decision-6): the anon/authenticated PostgREST surface RETAINS its SELECT
// grant on the lead-family tables, justified SOLELY by the precondition that the app never
// reads those tables through PostgREST — every query runs via Drizzle on the owner connection
// (ADR-0013), and no client bundle ships a Supabase client that could `.from()` a table.
//
// That precondition was prose-only (a migration comment + the ADR). This POLICY guard pins it,
// so a future portal-side PostgREST read cannot land without first tripping this test — which
// forces revisiting the SELECT-retained decision. Deleting this test is not that revisit.
//
// The two legitimate server-side Supabase clients are AUTH/service-role, not table reads:
//   - src/app/api/auth/reset/confirm/route.ts — anon client, `auth.verifyOtp`/password reset
//   - src/lib/supabase/admin.ts — service-role client, admin auth ops
// Neither calls `.from()`, so banning `.from()` on a Supabase client leaves them untouched.
const root = process.cwd();

const sourceFiles = () =>
  readdirSync(resolve(root, "src"), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => join(root, "src", f));

const isClientModule = (src: string) => /^\s*["']use client["']/m.test(src.slice(0, 500));

describe("C-29: no client-side PostgREST reads", () => {
  it("C-29: no source file reads a table via PostgREST (supabase.from(…))", () => {
    // The canonical PostgREST read pattern. Zero everywhere is the invariant — the app uses
    // Drizzle exclusively, so ANY `supabase.from(` is a regression, client or server.
    const offenders = sourceFiles().filter((f) => /supabase\s*\.\s*from\s*\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("C-29: no browser Supabase client is ever constructed (createBrowserClient)", () => {
    // @supabase/ssr's browser helper is the natural way a portal-side PostgREST read would be
    // added; banning it outright stops the client surface from existing in the first place.
    const offenders = sourceFiles().filter((f) => /createBrowserClient/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("C-29: no 'use client' module imports a Supabase client library", () => {
    const offenders = sourceFiles().filter((file) => {
      const src = readFileSync(file, "utf8");
      return isClientModule(src) && /from\s+["']@supabase\/(supabase-js|ssr)["']/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
