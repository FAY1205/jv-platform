"use client";

import * as React from "react";
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Stat,
  PartnerTag,
  Input,
  Skeleton,
} from "@/components";
import { PARTNER_PALETTE } from "@/lib/tokens/tokens";
import { APP_NAME } from "@/lib/app";

const SEMANTIC_SWATCHES: { label: string; varName: string; text?: boolean }[] = [
  { label: "bg", varName: "--bg" },
  { label: "surface", varName: "--surface" },
  { label: "surface-2", varName: "--surface-2" },
  { label: "surface-3", varName: "--surface-3" },
  { label: "border", varName: "--border" },
  { label: "brand", varName: "--brand" },
  { label: "brand-strong", varName: "--brand-strong" },
  { label: "info", varName: "--info" },
  { label: "success", varName: "--success" },
  { label: "warn", varName: "--warn" },
  { label: "danger", varName: "--danger" },
  { label: "prev", varName: "--prev" },
];

type Lead = {
  id: string;
  partner: string;
  addr: string;
  city: string;
  st: string;
  zip: string;
  seller: string;
  match: "zip" | "state";
  prev?: boolean;
  mls: "Yes" | "No" | "Unknown";
};

const LEADS: Lead[] = [
  { id: "LD-2026-00404", partner: "Josh Ax", addr: "142 Garden State Ave", city: "Cherry Hill", st: "NJ", zip: "08034", seller: "D. Romano", match: "state", mls: "No" },
  { id: "LD-2026-00409", partner: "Josh Ax", addr: "18 Pocono Ridge Ln", city: "Scranton", st: "PA", zip: "18503", seller: "K. Weiss", match: "zip", mls: "Unknown" },
  { id: "LD-2026-00415", partner: "Josh Ax", addr: "77 Sound View Ter", city: "New Haven", st: "CT", zip: "06511", seller: "M. Alves", match: "state", prev: true, mls: "No" },
  { id: "LD-2026-00406", partner: "Michael Pinter", addr: "311 Merrick Blvd", city: "Queens", st: "NY", zip: "11434", seller: "T. Okafor", match: "zip", mls: "Yes" },
  { id: "LD-2026-00411", partner: "Randy Wolfe", addr: "1204 Palmetto St", city: "Greenville", st: "SC", zip: "29601", seller: "B. Hutto", match: "state", mls: "No" },
  { id: "LD-2026-00405", partner: "Jeff Lister", addr: "2216 Pine St", city: "Philadelphia", st: "PA", zip: "19103", seller: "A. Boyd", match: "zip", mls: "Yes" },
];

const colorOf = (name: string) => PARTNER_PALETTE.find((p) => p.name === name)?.hex ?? "#999";
const refOf = (name: string) =>
  "JV-" + String(PARTNER_PALETTE.findIndex((p) => p.name === name) + 1).padStart(3, "0");

function MlsBadge({ v }: { v: Lead["mls"] }) {
  if (v === "Yes") return <Badge variant="removed">Possible</Badge>;
  if (v === "No") return <Badge variant="success">No</Badge>;
  return <Badge variant="neutral">Unknown</Badge>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-semibold tracking-tight mb-4">{title}</h2>
      {children}
    </section>
  );
}

export default function GalleryPage() {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="min-h-full bg-bg text-text">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center gap-3 h-14 px-5 border-b border-border bg-surface">
        <span className="grid grid-cols-3 gap-[2px]" aria-hidden="true">
          {PARTNER_PALETTE.slice(0, 9).map((p) => (
            <i key={p.name} className="w-[5px] h-[5px] rounded-[1.5px]" style={{ background: p.hex }} />
          ))}
        </span>
        <h1 className="font-display text-base font-bold tracking-tight">{APP_NAME}</h1>
        <Badge variant="outline" className="ml-1">
          design system
        </Badge>
        <div className="ml-auto">
          <Button size="sm" variant="secondary" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>
            {theme === "light" ? "◑ Dark" : "◐ Light"}
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pb-20">
        <div className="mt-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Component library preview</h1>
          <p className="mt-2 text-text-2 max-w-2xl text-sm">
            The baseline is the demo&apos;s language — teal, Space&nbsp;Grotesk, Inter, IBM&nbsp;Plex&nbsp;Mono.
            The distinctive moves: the <b>partner token</b> (color + name + mono reference&nbsp;ID, so identity
            never rides on color alone), <b>ledger-grade tabular numerics</b>, and the partner-colored routing
            table. Toggle the theme, top-right.
          </p>
        </div>

        <Section title="Color tokens">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {SEMANTIC_SWATCHES.map((s) => (
              <div key={s.varName} className="flex items-center gap-3">
                <span
                  className="w-9 h-9 rounded-md border border-border shrink-0"
                  style={{ background: `var(${s.varName})` }}
                />
                <div className="leading-tight">
                  <div className="text-xs font-semibold">{s.label}</div>
                  <div className="num text-[.66rem] text-text-3">{s.varName}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Partner palette — locked, identified by color + name + reference ID">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {PARTNER_PALETTE.map((p, i) => (
              <PartnerTag key={p.name} name={p.name} color={p.hex} refId={`JV-${String(i + 1).padStart(3, "0")}`} />
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <div className="font-display text-3xl font-bold tracking-tight">Display · Space Grotesk</div>
              <div className="text-base text-text-2">
                Body · Inter — deterministic lead-routing you can audit lead by lead.
              </div>
              <div className="num text-sm text-text-2">
                Mono · IBM Plex — LD-2026-00404 · ZIP 06404 · 06511 · 1,284 leads · 77.8%
              </div>
            </CardBody>
          </Card>
        </Section>

        <Section title="Buttons — all states">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary">Process file</Button>
                <Button variant="secondary">Export</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="danger">Void run</Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" size="sm">Small primary</Button>
                <Button variant="secondary" disabled>Disabled</Button>
                <Button variant="primary" loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1400); }}>
                  {loading ? "Processing…" : "Click to load"}
                </Button>
              </div>
            </CardBody>
          </Card>
        </Section>

        <Section title="Badges">
          <Card>
            <CardBody className="flex flex-wrap gap-2.5">
              <Badge variant="zip" dot>ZIP</Badge>
              <Badge variant="state" dot>State fallback</Badge>
              <Badge variant="removed">Removed · on-market</Badge>
              <Badge variant="warn">Coverage gap</Badge>
              <Badge variant="prev">Previously matched</Badge>
              <Badge variant="success" dot>Kept</Badge>
              <Badge variant="neutral">Unknown</Badge>
              <Badge variant="outline">heuristic</Badge>
            </CardBody>
          </Card>
        </Section>

        <Section title="KPI readouts">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <Card><CardBody><Stat label="Matched this week" value="21" delta={{ dir: "up", text: "16%" }} foot="of 27 uploaded · 77.8% match rate" /></CardBody></Card>
            <Card><CardBody><Stat label="Removed · on-market" value="3" delta={{ dir: "flat", text: "0%" }} foot="explicit MLS positive in Notes" /></CardBody></Card>
            <Card><CardBody><Stat label="Unmatched · gaps" value="2" delta={{ dir: "down", text: "2" }} foot="TX, MS — no partner rule" /></CardBody></Card>
            <Card><CardBody><Stat label="Processing time" value={<>41<span className="text-text-3 text-xl">s</span></>} foot="upload → distributed · 8 steps" /></CardBody></Card>
          </div>
        </Section>

        <Section title="Inputs">
          <Card>
            <CardBody className="grid sm:grid-cols-3 gap-4">
              <Input label="Partner name" placeholder="e.g. Josh Ax" defaultValue="Josh Ax" />
              <Input label="Seller ZIP" placeholder="5 digits" hint="Leading zeros are preserved" defaultValue="06511" />
              <Input label="Seller ZIP" placeholder="5 digits" defaultValue="6404" error="ZIP must be 5 digits" />
            </CardBody>
          </Card>
        </Section>

        <Section title="Signature — the routing table">
          <Card>
            <CardHeader>
              <CardTitle>Leads — this upload</CardTitle>
              <span className="text-xs text-text-3">row color = partner · ZIP beats state fallback</span>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left">
                    {["Lead ID", "Partner", "Address", "City", "St", "ZIP", "Seller", "Match", "Prev.", "MLS?"].map((h) => (
                      <th key={h} className="text-[.65rem] uppercase tracking-wider text-text-3 font-semibold px-3.5 py-2.5 border-b border-border bg-surface-2 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LEADS.map((l) => {
                    const c = colorOf(l.partner);
                    return (
                      <tr
                        key={l.id}
                        className="border-b border-border-soft"
                        style={{ background: `color-mix(in srgb, ${c} 7%, var(--surface))` }}
                      >
                        <td className="num text-text-3 px-3.5 py-2.5 whitespace-nowrap" style={{ borderLeft: `3px solid ${c}` }}>{l.id}</td>
                        <td className="px-3.5 py-2.5"><PartnerTag name={l.partner} color={c} refId={refOf(l.partner)} size="sm" /></td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">{l.addr}</td>
                        <td className="px-3.5 py-2.5">{l.city}</td>
                        <td className="px-3.5 py-2.5">{l.st}</td>
                        <td className="num px-3.5 py-2.5">{l.zip}</td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">{l.seller}</td>
                        <td className="px-3.5 py-2.5">{l.match === "zip" ? <Badge variant="zip" dot>ZIP</Badge> : <Badge variant="state" dot>State</Badge>}</td>
                        <td className="px-3.5 py-2.5">{l.prev ? <Badge variant="prev">Yes</Badge> : <span className="text-text-3">—</span>}</td>
                        <td className="px-3.5 py-2.5"><MlsBadge v={l.mls} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4 flex flex-wrap gap-2">
            {PARTNER_PALETTE.slice(0, 4).map((p) => (
              <span key={p.name} className="inline-flex items-center gap-2 border border-border rounded-md px-3 py-1.5 text-xs font-semibold bg-surface">
                <span className="w-[18px] h-[18px] rounded-[6px] border border-black/15" style={{ background: p.hex }} />
                {p.name}
                <span className="num text-[.62rem] text-text-3">{p.hex.toUpperCase()}</span>
              </span>
            ))}
          </div>
        </Section>

        <Section title="Loading state">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-8 w-1/4" />
              <Skeleton className="h-24 w-full" />
            </CardBody>
          </Card>
        </Section>
      </main>
    </div>
  );
}
