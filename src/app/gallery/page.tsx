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
  NativeSelect,
  Table,
  THead,
  TBody,
  Th,
  Tr,
  Td,
  type SortDir,
  Tabs,
  Modal,
  Tooltip,
  ToastProvider,
  useToast,
  EmptyState,
  Skeleton,
} from "@/components";
import { PARTNER_PALETTE } from "@/lib/tokens/tokens";
import { APP_NAME } from "@/lib/app";

const SEMANTIC_SWATCHES: { label: string; varName: string }[] = [
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
  return (
    <ToastProvider>
      <Gallery />
    </ToastProvider>
  );
}

function Gallery() {
  const { toast } = useToast();
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  const [loading, setLoading] = React.useState(false);
  const [tab, setTab] = React.useState("zip");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [addrSort, setAddrSort] = React.useState<SortDir>(null);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const rows = React.useMemo(() => {
    const base = [...LEADS];
    if (!addrSort) return base;
    return base.sort((a, b) => (a.addr < b.addr ? -1 : 1) * (addrSort === "asc" ? 1 : -1));
  }, [addrSort]);

  return (
    <div className="min-h-full bg-bg text-text">
      <header className="sticky top-0 z-10 flex items-center gap-3 h-14 px-5 border-b border-border bg-surface">
        <span className="grid grid-cols-3 gap-[2px]" aria-hidden="true">
          {PARTNER_PALETTE.slice(0, 9).map((p) => (
            <i key={p.name} className="w-[5px] h-[5px] rounded-[1.5px]" style={{ background: p.hex }} />
          ))}
        </span>
        <h1 className="font-display text-base font-bold tracking-tight">{APP_NAME}</h1>
        <Badge variant="outline" className="ml-1">design system</Badge>
        <div className="ml-auto">
          <Button size="sm" variant="secondary" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>
            {theme === "light" ? "◑ Dark" : "◐ Light"}
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pb-20">
        <div className="mt-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Component library</h1>
          <p className="mt-2 text-text-2 max-w-2xl text-sm">
            Baseline is the demo&apos;s language — teal, Space&nbsp;Grotesk, Inter, IBM&nbsp;Plex&nbsp;Mono.
            The distinctive moves: the <b>partner token</b> (color + name + mono reference&nbsp;ID),
            <b> ledger-grade tabular numerics</b>, and the partner-colored routing table.
          </p>
        </div>

        <Section title="Color tokens">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {SEMANTIC_SWATCHES.map((s) => (
              <div key={s.varName} className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-md border border-border shrink-0" style={{ background: `var(${s.varName})` }} />
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
              <div className="text-base text-text-2">Body · Inter — deterministic lead-routing you can audit lead by lead.</div>
              <div className="num text-sm text-text-2">Mono · IBM Plex — LD-2026-00404 · ZIP 06404 · 06511 · 1,284 leads · 77.8%</div>
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
                <Button variant="danger" onClick={() => setModalOpen(true)}>Void run</Button>
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
            <Card><CardBody><Stat label="Matched this week" value="21" delta={{ dir: "up", text: "16%" }} foot={<Tooltip content="Matched ÷ uploaded, this run"><span className="underline decoration-dotted cursor-help">77.8% match rate</span></Tooltip>} /></CardBody></Card>
            <Card><CardBody><Stat label="Removed · on-market" value="3" delta={{ dir: "flat", text: "0%" }} foot="explicit MLS positive in Notes" /></CardBody></Card>
            <Card><CardBody><Stat label="Unmatched · gaps" value="2" delta={{ dir: "down", text: "2" }} foot="TX, MS — no partner rule" /></CardBody></Card>
            <Card><CardBody><Stat label="Processing time" value={<>41<span className="text-text-3 text-xl">s</span></>} foot="upload → distributed · 8 steps" /></CardBody></Card>
          </div>
        </Section>

        <Section title="Form controls">
          <Card>
            <CardBody className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input label="Partner name" placeholder="e.g. Josh Ax" defaultValue="Josh Ax" />
              <Input label="Seller ZIP" placeholder="5 digits" hint="Leading zeros preserved" defaultValue="06511" />
              <Input label="Seller ZIP" placeholder="5 digits" defaultValue="6404" error="ZIP must be 5 digits" />
              <NativeSelect label="Match type" defaultValue="zip" options={[{ value: "zip", label: "ZIP match" }, { value: "state", label: "State fallback" }, { value: "none", label: "Unmatched" }]} />
            </CardBody>
          </Card>
        </Section>

        <Section title="Tabs & overlays">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <Tabs
                items={[
                  { id: "zip", label: "ZIP coverage" },
                  { id: "state", label: "State fallbacks" },
                  { id: "mls", label: "MLS patterns" },
                ]}
                value={tab}
                onValueChange={setTab}
              />
              <p className="text-sm text-text-2">
                Active tab: <span className="num">{tab}</span> — tabs are keyboard-navigable (←/→).
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => setModalOpen(true)}>Open confirm dialog</Button>
                <Button variant="secondary" onClick={() => toast("Export started — you’ll be notified")}>Show toast</Button>
                <Button variant="secondary" onClick={() => toast("Status saved — visible to your admin", "success")}>Success toast</Button>
              </div>
            </CardBody>
          </Card>
        </Section>

        <Section title="Signature — the routing table">
          <Card>
            <CardHeader>
              <CardTitle>Leads — this upload</CardTitle>
              <span className="text-xs text-text-3">row color = partner · ZIP beats state fallback</span>
            </CardHeader>
            <Table>
              <THead>
                <tr>
                  <Th>Lead ID</Th>
                  <Th>Partner</Th>
                  <Th sortable sortDir={addrSort} onSort={() => setAddrSort((d) => (d === "asc" ? "desc" : "asc"))}>Address</Th>
                  <Th>City</Th>
                  <Th>St</Th>
                  <Th>ZIP</Th>
                  <Th>Seller</Th>
                  <Th>Match</Th>
                  <Th>Prev.</Th>
                  <Th>MLS?</Th>
                </tr>
              </THead>
              <TBody>
                {rows.map((l) => {
                  const c = colorOf(l.partner);
                  return (
                    <Tr key={l.id} accent={c}>
                      <Td rail={c} className="num text-text-3 whitespace-nowrap">{l.id}</Td>
                      <Td><PartnerTag name={l.partner} color={c} refId={refOf(l.partner)} size="sm" /></Td>
                      <Td className="whitespace-nowrap">{l.addr}</Td>
                      <Td>{l.city}</Td>
                      <Td>{l.st}</Td>
                      <Td className="num">{l.zip}</Td>
                      <Td className="whitespace-nowrap">{l.seller}</Td>
                      <Td>{l.match === "zip" ? <Badge variant="zip" dot>ZIP</Badge> : <Badge variant="state" dot>State</Badge>}</Td>
                      <Td>{l.prev ? <Badge variant="prev">Yes</Badge> : <span className="text-text-3">—</span>}</Td>
                      <Td><MlsBadge v={l.mls} /></Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        </Section>

        <Section title="Empty & loading states">
          <div className="grid md:grid-cols-2 gap-3.5">
            <Card>
              <EmptyState
                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></svg>}
                title="No uploads yet"
                description="Process your first weekly file to see matched leads, removals, and coverage gaps here."
                action={<Button variant="primary">New upload</Button>}
              />
            </Card>
            <Card>
              <CardBody className="flex flex-col gap-3">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-8 w-1/4" />
                <Skeleton className="h-24 w-full" />
              </CardBody>
            </Card>
          </div>
        </Section>
      </main>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Delete partner JV-003 — Michael Pinter?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setModalOpen(false); toast("Partner deleted", "danger"); }}>Delete partner</Button>
          </>
        }
      >
        <p className="text-sm text-text-2">
          This partner owns coverage ZIPs. Historical assignments are kept (PRN-05); future runs route their
          territory to Unmatched until reassigned. High-impact deletes require typing the reference ID (FRM-03).
        </p>
      </Modal>
    </div>
  );
}
