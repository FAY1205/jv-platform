"use client";

import * as React from "react";
import { statusPillClass } from "@/lib/status-pill";
import {
  Button,
  IconButton,
  LinkCard,
  FilterPill,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Stat,
  HeroKpi,
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
  Dialog,
  Tooltip,
  Select,
  StatusSelect,
  SegmentedControl,
  Combobox,
  Checkbox,
  Switch,
  NotificationTypeIcon,
  DatePicker,
  DateRangePicker,
  type DateRangeValue,
  Pagination,
  DEFAULT_PAGE_SIZE,
  RowOpenButton,
  LineChart,
  DonutChart,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  ToastProvider,
  useToast,
  EmptyState,
  Skeleton,
} from "@/components";
import { PARTNER_PALETTE } from "@/lib/tokens/tokens";
import { APP_NAME } from "@/lib/app";
// Assistant components are client-only and intentionally out of the "@/components" barrel
// (keeps AI deps off the base bundle); the living showcase imports them directly.
import { Orb } from "@/components/assistant/Orb";
import { SuggestionChips } from "@/components/assistant/SuggestionChips";
import { AssistantMessage } from "@/components/assistant/AssistantMessage";
import { AssistantIconButton } from "@/components/assistant/AssistantIconButton";

const SEMANTIC_SWATCHES: { label: string; varName: string }[] = [
  { label: "bg", varName: "--bg" },
  { label: "surface", varName: "--surface" },
  { label: "surface-2", varName: "--surface-2" },
  { label: "surface-3", varName: "--surface-3" },
  { label: "border", varName: "--border" },
  { label: "border-strong", varName: "--border-strong" },
  { label: "brand", varName: "--brand" },
  { label: "brand-strong", varName: "--brand-strong" },
  { label: "brand-ink", varName: "--brand-ink" },
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
  { id: "LD-26-00404", partner: "Josh Ax", addr: "142 Garden State Ave", city: "Cherry Hill", st: "NJ", zip: "08034", seller: "D. Romano", match: "state", mls: "No" },
  { id: "LD-26-00409", partner: "Josh Ax", addr: "18 Pocono Ridge Ln", city: "Scranton", st: "PA", zip: "18503", seller: "K. Weiss", match: "zip", mls: "Unknown" },
  { id: "LD-26-00415", partner: "Josh Ax", addr: "77 Sound View Ter", city: "New Haven", st: "CT", zip: "06511", seller: "M. Alves", match: "state", prev: true, mls: "No" },
  { id: "LD-26-00406", partner: "Michael Pinter", addr: "311 Merrick Blvd", city: "Queens", st: "NY", zip: "11434", seller: "T. Okafor", match: "zip", mls: "Yes" },
  { id: "LD-26-00411", partner: "Randy Wolfe", addr: "1204 Palmetto St", city: "Greenville", st: "SC", zip: "29601", seller: "B. Hutto", match: "state", mls: "No" },
  { id: "LD-26-00405", partner: "Jeff Lister", addr: "2216 Pine St", city: "Philadelphia", st: "PA", zip: "19103", seller: "A. Boyd", match: "zip", mls: "Yes" },
];

const colorOf = (name: string) => PARTNER_PALETTE.find((p) => p.name === name)?.hex ?? PARTNER_PALETTE[0].hex;
const refOf = (name: string) =>
  "PR-" + String(PARTNER_PALETTE.findIndex((p) => p.name === name) + 1).padStart(3, "0");

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

// Stateful Combobox demo (the gallery page itself stays render-pure).
function ComboboxDemo() {
  const [state, setState] = React.useState("");
  return (
    <Combobox
      ariaLabel="Filter by state"
      placeholder="All states"
      value={state}
      onValueChange={setState}
      options={[
        { value: "FL", label: "Florida (FL)" },
        { value: "TN", label: "Tennessee (TN)" },
        { value: "TX", label: "Texas (TX)" },
        { value: "WA", label: "Washington (WA)" },
      ]}
    />
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
  // WS-1 primitive demo state.
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectVal, setSelectVal] = React.useState("new");
  const [checkA, setCheckA] = React.useState(true);
  const [checkB, setCheckB] = React.useState(false);
  const [switchA, setSwitchA] = React.useState(true);
  const [switchB, setSwitchB] = React.useState(false);
  const [date, setDate] = React.useState<string | null>("2026-07-10");
  const [range, setRange] = React.useState<DateRangeValue>({ from: "2026-07-01", to: "2026-07-10" });
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const [seg, setSeg] = React.useState("30d");

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
                  <div className="num text-step-0 text-text-3">{s.varName}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Partner palette — locked, identified by color + name + reference ID">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {PARTNER_PALETTE.map((p, i) => (
              <PartnerTag key={p.name} name={p.name} color={p.hex} refId={`PR-${String(i + 1).padStart(3, "0")}`} />
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <div className="font-display text-3xl font-bold tracking-tight">Display · Space Grotesk</div>
              <div className="text-base text-text-2">Body · Inter — deterministic lead-routing you can audit lead by lead.</div>
              <div className="num text-sm text-text-2">Mono · IBM Plex — LD-26-00404 · ZIP 06404 · 06511 · 1,284 leads · 77.8%</div>
            </CardBody>
          </Card>
        </Section>

        <Section title="Type scale (DSN-11)">
          <Card>
            <CardBody className="flex flex-col">
              {[
                ["text-step-0", "12px", "micro (= text-xs) — sub-13px meta (WP-P)"],
                ["text-step-1", "13px", "chrome floor: labels, meta, dense text"],
                ["text-step-2", "14px", "body-sm — vocab (= text-sm), not yet adopted"],
                ["text-step-3", "16px", "base/body; small card headings"],
                ["text-step-4", "18px", "vocab (= text-lg), not yet adopted"],
                ["text-step-5", "24px", "vocab (= text-2xl), not yet adopted"],
                ["text-step-6", "30px", "vocab (= text-3xl), not yet adopted"],
                ["text-step-7", "32px", "hero/display"],
              ].map(([cls, px, role]) => (
                <div key={cls} className="flex items-baseline gap-3 border-b border-border-soft py-1.5 last:border-0">
                  <span className={cls + " font-semibold text-text"}>Ag</span>
                  <span className="num text-step-1 text-text-2">{cls}</span>
                  <span className="num text-step-1 text-text-3">{px}</span>
                  <span className="text-step-1 text-text-3">{role}</span>
                </div>
              ))}
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
                <Button variant="secondary" size="lg">Large — 44px (F-66)</Button>
                <Button variant="secondary" disabled>Disabled</Button>
                <Button variant="primary" loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1400); }}>
                  {loading ? "Processing…" : "Click to load"}
                </Button>
              </div>
            </CardBody>
          </Card>
        </Section>

        <Section title="IconButton — 44px chrome control (DSN-03, F-66)">
          <Card>
            <CardBody className="flex flex-wrap items-center gap-3">
              <IconButton aria-label="Settings">
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" />
                </svg>
              </IconButton>
              <IconButton aria-label="Disabled example" disabled>
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                </svg>
              </IconButton>
              <IconButton aria-label="Loading example" loading>
                <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /></svg>
              </IconButton>
              <span className="text-step-1 text-text-3">Hover = hairline border + surface; focus-visible = 1px brand-ink outline; active = scale-95.</span>
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

        <Section title="FilterPill — toggleable filter chips (DSN-03, D3)">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold text-text-3">Status</span>
                <FilterPill active>Contacted</FilterPill>
                <FilterPill>New</FilterPill>
                <FilterPill>Under contract</FilterPill>
                <FilterPill disabled>Dead</FilterPill>
              </div>
              <p className="text-step-1 text-text-3">
                Promoted from two byte-identical hand-rolled copies (admin Leads + portal Leads).
                Carries <code className="num">aria-pressed</code> itself; active = brand fill, idle = bordered surface,
                press scale + disabled per DSN-03; focus ring from the global outline.
              </p>
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

        <Section title="Hero KPI — shared by the admin & partner dashboards (P-7)">
          {/* Loading/error are the CALLER's concern (both dashboards skeleton the whole hero);
              this cell renders the settled number, an optional prior-window delta, tone, and a
              calc tooltip. `dense` trims padding for the portal's mobile tiles. */}
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border-soft lg:grid-cols-4">
            <HeroKpi label="Leads this week" value={412} delta={16} tip="Distributed to you in the selected range" />
            <HeroKpi label="Contacted" value={318} delta={0} tone="brand" />
            <HeroKpi label="Untouched" value={12} delta={-4} tone="warn" tip="No status change since assignment" />
            <HeroKpi label="Closed" value={57} delta={null} />
          </div>
          <p className="mt-2 text-step-1 text-text-3">
            <code>delta</code>: a number renders “↑/↓ N vs prior”, <code>0</code> renders “same”, <code>null</code> renders “all time”; omit it for no delta line.
          </p>
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

        <Section title="Combobox — searchable single-select (DSN-03, T2)">
          <p className="mb-3 text-step-1 text-text-3">
            Type to filter; ArrowUp/Down + Enter select; Esc reverts; the ✕ clears. Built for the
            Leads state filter (full names, not 2-letter codes) — ARIA 1.2 combobox, hand-rolled
            like SegmentedControl/Switch (no new deps).
          </p>
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <ComboboxDemo />
            <Combobox ariaLabel="Disabled demo" placeholder="Disabled" options={[]} value="" onValueChange={() => {}} disabled />
          </div>
        </Section>

        <Section title="Segmented control — all states">
          <div className="flex flex-wrap items-center gap-6">
            <SegmentedControl
              ariaLabel="Time range"
              value={seg}
              onValueChange={setSeg}
              options={[
                { value: "7d", label: "7 days" },
                { value: "30d", label: "30 days" },
                { value: "12mo", label: "12 months" },
                { value: "all", label: "All" },
              ]}
            />
            <SegmentedControl
              ariaLabel="Disabled example"
              value="30d"
              onValueChange={() => {}}
              disabled
              options={[
                { value: "7d", label: "7 days" },
                { value: "30d", label: "30 days" },
              ]}
            />
          </div>
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

        <Section title="LinkCard — tappable card chrome (DSN)">
          <p className="mb-3 text-step-1 text-text-3">Hover/focus-visible/active states are the anchor&apos;s own chrome; no disabled/loading — LinkCard is a link, not a control. Callers own layout (block vs flex).</p>
          <div className="grid gap-3 md:grid-cols-2">
            <LinkCard href="#" className="block p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="num text-step-1 text-text-3">LD-26-00404</span>
                <span className={statusPillClass("Contacted", "ml-auto")}>Contacted</span>
              </div>
              <div className="mt-1.5 text-base font-semibold text-text">120 Maple Ave</div>
              <div className="mt-1 text-step-1 text-text-2">Austin, TX · <span className="num">78701</span></div>
            </LinkCard>
            <LinkCard href="#" className="flex min-h-[52px] flex-col justify-center px-4 py-2.5">
              <span className="text-sm font-semibold text-text">Your devices</span>
              <span className="text-step-1 text-text-3">Remembered browsers you can sign out</span>
            </LinkCard>
          </div>
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
            {/* Compact variant — fills an embedded panel (e.g. a map that failed to load). */}
            <Card>
              <div className="h-40">
                <EmptyState compact title="Territory map unavailable." />
              </div>
            </Card>
          </div>
        </Section>

        <Section title="Foundation primitives — REDESIGN-R3 WS-1 (Radix + Recharts)">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Select (Radix, controlled)</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-4">
                <div className="max-w-xs">
                  <Select
                    label="Status"
                    value={selectVal}
                    onValueChange={setSelectVal}
                    options={[
                      { value: "new", label: "New" },
                      { value: "contacted", label: "Contacted" },
                      { value: "appointment", label: "Appointment" },
                      { value: "closed", label: "Closed" },
                    ]}
                  />
                </div>
                <div className="max-w-xs">
                  <Select label="Disabled" value="new" onValueChange={() => {}} disabled options={[{ value: "new", label: "New" }]} />
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>StatusSelect (pill; kept vs removed)</CardTitle></CardHeader>
              <CardBody className="flex flex-wrap items-center gap-4">
                <StatusSelect refId="LD-26-00404" status="Contacted" mlsStatus="kept" />
                <StatusSelect refId="LD-26-00405" status="Closed" mlsStatus="kept" />
                <StatusSelect refId="LD-26-00406" status="New" mlsStatus="removed" />
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Checkbox</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-3">
                <Checkbox checked={checkA} onCheckedChange={setCheckA} label="Email digest" />
                <Checkbox checked={checkB} onCheckedChange={setCheckB} label="In-app alerts" />
                <Checkbox checked={false} onCheckedChange={() => {}} label="Disabled" disabled />
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Switch (on-state = route)</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-3">
                <Switch checked={switchA} onCheckedChange={setSwitchA} label="Sold or pending listings" />
                <Switch checked={switchB} onCheckedChange={setSwitchB} label="Auction & short-sale" />
                <Switch checked disabled onCheckedChange={() => {}} label="Disabled — on" />
                <Switch checked={false} disabled onCheckedChange={() => {}} label="Disabled — off" />
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Notification type tiles</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-3">
                {[
                  { type: "run_summary", label: "Import IM-26-044 distributed 412 leads." },
                  { type: "new_leads", label: "36 new leads matched to your territory." },
                  { type: "status_change", label: "A lead you own moved to Contacted." },
                  { type: "system", label: "Unmapped type — neutral fallback." },
                ].map((n) => (
                  <div key={n.type} className="flex items-start gap-2.5">
                    <NotificationTypeIcon type={n.type} />
                    <div className="min-w-0">
                      <p className="text-sm text-text">{n.label}</p>
                      <p className="num text-step-1 text-text-3">{n.type}</p>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Status fills — on-status ink (WP-H)</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-3">
                <p className="text-step-1 text-text-2">
                  Text on a solid status fill uses <span className="num">--on-status</span> — white in
                  light, near-black in dark — so it stays AA in both themes (hardcoded white-on-fill
                  failed in dark: danger 3.4:1, success 2.6:1).
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <span className="rounded-lg bg-danger text-on-status text-sm font-semibold px-3.5 py-2">Void run</span>
                  <span className="rounded-lg bg-success text-on-status text-sm font-semibold px-3.5 py-2">Status saved</span>
                  <span className="rounded-lg bg-brand text-brand-contrast text-sm font-semibold px-3.5 py-2">Process file</span>
                </div>
                <div className="flex items-center gap-2.5 pt-1">
                  <PartnerTag name="Josh Ax" color={colorOf("Josh Ax")} refId="PR-003" />
                  <span className="text-step-1 text-text-3">swatch edge = <span className="num">--swatch-border</span> (theme-aware)</span>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Date + range pickers</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-4">
                <div className="max-w-xs"><DatePicker label="Single date" value={date} onChange={setDate} /></div>
                <div className="max-w-xs"><DateRangePicker label="Date range" value={range} onChange={setRange} /></div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Dropdown menu + Dialog + row-open</CardTitle></CardHeader>
              <CardBody className="flex flex-wrap items-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm">Actions ▾</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>Partner</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => toast("Edit", "success")}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => toast("Reactivate", "success")}>Reactivate</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => toast("Deactivated", "danger")}>Deactivate</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>Open Dialog</Button>
                <RowOpenButton onClick={() => setDialogOpen(true)}>LD-26-00404</RowOpenButton>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Pagination</CardTitle></CardHeader>
              <CardBody>
                <Pagination page={page} pageSize={pageSize} total={137} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Line chart (Recharts)</CardTitle></CardHeader>
              <CardBody>
                <LineChart
                  xKey="day"
                  series={[
                    { key: "in", name: "Leads in", color: "var(--brand)" },
                    { key: "distributed", name: "Distributed", color: "var(--info)" },
                    { key: "unmatched", name: "Unmatched", color: "var(--warn)" },
                  ]}
                  data={[
                    { day: "Mon", in: 42, distributed: 33, unmatched: 9 },
                    { day: "Tue", in: 51, distributed: 44, unmatched: 7 },
                    { day: "Wed", in: 38, distributed: 30, unmatched: 8 },
                    { day: "Thu", in: 60, distributed: 52, unmatched: 8 },
                    { day: "Fri", in: 47, distributed: 41, unmatched: 6 },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Donut chart (Recharts)</CardTitle></CardHeader>
              <CardBody>
                <DonutChart
                  centerLabel="removed"
                  data={[
                    { name: "Lead Zolo", value: 18, color: colorOf("Josh Ax") },
                    { name: "Real Estate Bees", value: 11, color: colorOf("Randy Wolfe") },
                    { name: "Facebook Ads", value: 7, color: colorOf("Michael Pinter") },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
        </Section>

        <Section title="AI assistant (WP-AI-2) — floating admin chat">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Orb — theme-aware plasma launcher</CardTitle></CardHeader>
              <CardBody className="flex flex-wrap items-end gap-6">
                {[
                  { size: 52, animate: true, label: "launcher · animate" },
                  { size: 52, animate: false, label: "launcher · static" },
                  { size: 34, animate: false, label: "header 34" },
                  { size: 24, animate: false, label: "avatar 24" },
                ].map((o) => (
                  <div key={o.label} className="flex flex-col items-center gap-1.5">
                    <Orb size={o.size} animate={o.animate} />
                    <span className="text-step-1 text-text-3">{o.label}</span>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Icon buttons — compact panel controls</CardTitle>
                <span className="text-xs text-text-3">sub-44px per mockup rev-7 (WCAG 2.1 AA); default · disabled · loading</span>
              </CardHeader>
              <CardBody className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <span className="w-16 text-step-1 text-text-3">ghost 34</span>
                  <AssistantIconButton variant="ghost" aria-label="Close (demo)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </AssistantIconButton>
                  <AssistantIconButton variant="ghost" aria-label="Close disabled (demo)" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </AssistantIconButton>
                </div>
                <div className="flex items-center gap-4">
                  <span className="w-16 text-step-1 text-text-3">primary 36</span>
                  <AssistantIconButton variant="primary" aria-label="Send (demo)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </AssistantIconButton>
                  <AssistantIconButton variant="primary" aria-label="Send disabled (demo)" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </AssistantIconButton>
                  <AssistantIconButton variant="primary" aria-label="Send loading (demo)" loading>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </AssistantIconButton>
                </div>
                <div className="flex items-center gap-4">
                  <span className="w-16 text-step-1 text-text-3">toggle 26</span>
                  <AssistantIconButton variant="toggle" aria-label="Helpful (demo)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M7 11v9h10a3 3 0 0 0 3-3l-1-6a2 2 0 0 0-2-2h-4l1-4a2 2 0 0 0-2-2l-5 8H4v9h3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </AssistantIconButton>
                  <AssistantIconButton variant="toggle" aria-label="Helpful pressed (demo)" aria-pressed disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M7 11v9h10a3 3 0 0 0 3-3l-1-6a2 2 0 0 0-2-2h-4l1-4a2 2 0 0 0-2-2l-5 8H4v9h3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </AssistantIconButton>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Suggestion chips — contextual, per screen</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-4">
                <SuggestionChips
                  items={["How are my partners performing?", "Which states have no coverage?", "Explain this screen"]}
                  onSelect={() => {}}
                />
                <div>
                  <p className="mb-2 text-step-1 text-text-3">Disabled — while the assistant is capped or off:</p>
                  <SuggestionChips items={["Show top partners", "Where are my gaps?"]} onSelect={() => {}} disabled />
                </div>
              </CardBody>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Assistant message — sources, deep link, thumbs</CardTitle>
                <span className="text-xs text-text-3">answer body + tool-derived source chips + one whitelisted deep link (PRN-10)</span>
              </CardHeader>
              <CardBody className="flex flex-col gap-4 bg-bg">
                {/* Sources + an internal deep link (first internal path renders as the pill; others stay plain chips) + thumbs. */}
                <AssistantMessage
                  id="gallery-sources"
                  text={"**Meridian Buyers** leads on close rate.\n- PR-003 — 88 leads, 12% closed\n- PR-007 — 64 leads, 9% closed"}
                  sources={[{ label: "Partner performance", path: "/partners" }, { label: "Coverage map", path: "/coverage" }]}
                />
                {/* A non-internal path never links — the label still shows as a plain chip. */}
                <AssistantMessage
                  id="gallery-nonlink"
                  text="Last week's import distributed 412 leads across 11 states."
                  sources={[{ label: "External reference", path: "https://example.com/report" }]}
                />
                {/* No sources; pre-rated so the confirmation state is visible statically. */}
                <AssistantMessage
                  id="gallery-rated"
                  text="You have 7 active partners covering 42 states."
                  sources={[]}
                  defaultRating="up"
                />
                {/* Welcome variant — no thumbs. */}
                <AssistantMessage
                  id="gallery-welcome"
                  text="Hi — I can answer questions about your workspace: partners, leads, coverage, or what a screen does."
                  sources={[]}
                  showThumbs={false}
                />
              </CardBody>
            </Card>
          </div>
        </Section>
      </main>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Lead LD-26-00404"
        footer={<Button variant="primary" onClick={() => setDialogOpen(false)}>Done</Button>}
      >
        <p className="text-sm text-text-2">
          Radix Dialog — focus is trapped inside and returns to the trigger on close (F-15). Try Tab and Esc.
        </p>
      </Dialog>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Delete partner PR-003 — Michael Pinter?"
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
