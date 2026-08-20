"use client";

import * as React from "react";
import { statusPillClass } from "@/lib/status-pill";
import {
  Button,
  IconButton,
  LinkCard,
  FilterPill,
  Badge,
  RoleBadge,
  AvatarInitials,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Stat,
  HeroKpi,
  AccountMenuTrigger,
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
  AuthCardHeader,
  Dialog,
  SidePanel,
  ARROW_BUTTON_CLASS,
  Tooltip,
  Select,
  StatusSelect,
  SegmentedControl,
  Combobox,
  Checkbox,
  RadioGroup,
  RadioGroupItem,
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
  ClearFiltersButton,
  ScrollHintFade,
  SignOutLink,
  useScrollHint,
  QueryErrorState,
  Skeleton,
  ListingBadge,
  HotLeadMark,
  HotLeadIcon,
  StateMultiSelect,
  ClampedText,
  PortalDevices,
  TasksPanel,
  type LeadTask,
  MyTasksList,
  type MyTask,
  Timeline,
  type TimelineEntry,
  InlineField,
} from "@/components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
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

// R-57 catch-up demos (DSN-03: every primitive also lives in the gallery).
const LONG_NOTE =
  "Two-story colonial on a corner lot; the seller is relocating for work and wants a fast, clean close. " +
  "Roof replaced 2021, HVAC 2019. A tenant occupies the lower unit month-to-month. Minor deferred maintenance " +
  "in the basement (some moisture). The seller is open to a rent-back of up to 30 days and will consider a cash " +
  "offer below list for certainty of close. No showings before noon on weekdays.";

function StateMultiSelectDemo() {
  const [states, setStates] = React.useState<string[]>(["NJ", "PA", "NY"]);
  return (
    <>
      <StateMultiSelect selected={states} onChange={setStates} />
      <p className="mt-2 text-step-1 text-text-3">
        Selected: <span className="num">{states.join(", ") || "none"}</span> — pick from the canonical 50-state + DC
        list, so an invalid state is impossible by construction (WP-C).
      </p>
    </>
  );
}

function RadioGroupDemo() {
  const [mode, setMode] = React.useState("reassign");
  return (
    <RadioGroup ariaLabel="Where should this territory go?" value={mode} onValueChange={setMode}>
      <RadioGroupItem value="reassign" label="Reassign to another partner" />
      {mode === "reassign" && (
        <div className="pl-6">
          <NativeSelect
            aria-label="Reassign to partner"
            options={[
              { value: "p1", label: "Randy Wolfe (PR-006)" },
              { value: "p2", label: "Jeff Lister (PR-004)" },
            ]}
          />
        </div>
      )}
      <RadioGroupItem value="unmatched" label="Route this territory to Unmatched" />
      <RadioGroupItem value="disabled" label="A disabled option" disabled />
    </RadioGroup>
  );
}

// PortalDevices reads ["sessions"] via TanStack Query; the living showcase SEEDS that cache so
// the real component renders its device list with no network call (the light query-mock harness
// the audit asks for). Revoke fires a real POST on click — in the dev-only gallery a failure
// just surfaces the component's own error line.
function PortalDevicesDemo() {
  const [qc] = React.useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["sessions"], {
      devices: [
        { familyId: "d1", deviceLabel: "Chrome · macOS", ip: "203.0.113.7", createdAt: "2026-07-01T00:00:00Z", lastSeenAt: "2026-07-10T14:30:00Z" },
        { familyId: "d2", deviceLabel: "Safari · iPhone", ip: "203.0.113.9", createdAt: "2026-06-15T00:00:00Z", lastSeenAt: "2026-07-09T08:12:00Z" },
      ],
    });
    return client;
  });
  return (
    <QueryClientProvider client={qc}>
      <PortalDevices />
    </QueryClientProvider>
  );
}

// WP-TSK-4 — design F-1: a new component gets a gallery card in the same WP that adds it.
// Both panels own their own data fetching (TanStack Query), so each demo below seeds an
// isolated QueryClient with the SAME query key the real component reads — the
// PortalDevicesDemo pattern above — rather than passing static props. Mutation clicks
// (checkbox, delete, add) still fire a real request; a failure just surfaces the panel's
// own toast/error line, exactly like Portal devices' revoke button.
const TASKS_DEMO_REF = "LD-26-00404";
// C-11: the demo viewer, so the gallery shows the identity cluster resolving to "You" on
// own rows and to a colleague's email on gt-3. Seeded into each demo's ["me"] cache below
// (TasksPanel reads useCurrentUser for the "You" rule and the work.write chrome gate).
const TASKS_DEMO_ME = {
  email: "casey.morgan@meridian.example",
  role: "admin" as const,
  capabilities: ["leads.read", "leads.write", "work.write", "views.own"],
  workspace: { name: "Meridian Property Group" },
  isPlatformOwner: false,
};
const DEMO_SELF = { email: TASKS_DEMO_ME.email, role: "admin" as const, deactivated: false };
const DEMO_COLLEAGUE = { email: "dana.reyes@meridian.example", role: "member" as const, deactivated: false };
const TASKS_DEMO: LeadTask[] = [
  { id: "gt-1", title: "Call seller to schedule walkthrough", dueOn: "2026-08-14", assignedToUserId: "u1", authorUserId: "u1", authorRole: "admin", doneAt: null, createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z", assignee: DEMO_SELF, author: DEMO_SELF },
  { id: "gt-2", title: "Send comps + preliminary offer range", dueOn: "2026-08-15", assignedToUserId: "u1", authorUserId: "u1", authorRole: "admin", doneAt: null, createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z", assignee: DEMO_SELF, author: DEMO_SELF },
  { id: "gt-3", title: "Quarterly nurture check-in", dueOn: "2026-08-20", assignedToUserId: "u2", authorUserId: "u2", authorRole: "admin", doneAt: null, createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z", assignee: DEMO_COLLEAGUE, author: DEMO_COLLEAGUE },
  { id: "gt-4", title: "Initial contact — left voicemail", dueOn: null, assignedToUserId: "u1", authorUserId: "u1", authorRole: "admin", doneAt: "2026-08-12T16:00:00.000Z", createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-12T16:00:00.000Z", assignee: DEMO_SELF, author: DEMO_SELF },
];

function TasksPanelDemo() {
  const [qc] = React.useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["me"], TASKS_DEMO_ME);
    client.setQueryData(["lead-tasks", TASKS_DEMO_REF], { tasks: TASKS_DEMO });
    return client;
  });
  return (
    <QueryClientProvider client={qc}>
      <TasksPanel leadRef={TASKS_DEMO_REF} today="2026-08-15" />
    </QueryClientProvider>
  );
}

function TasksPanelEmptyDemo() {
  const [qc] = React.useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["me"], TASKS_DEMO_ME);
    client.setQueryData(["lead-tasks", "LD-26-DEMO-EMPTY"], { tasks: [] });
    return client;
  });
  return (
    <QueryClientProvider client={qc}>
      <TasksPanel leadRef="LD-26-DEMO-EMPTY" today="2026-08-15" />
    </QueryClientProvider>
  );
}

function TasksPanelErrorDemo() {
  const [qc] = React.useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["me"], TASKS_DEMO_ME);
    // A fully offline, deterministic error: prefetch the SAME key with a queryFn that
    // rejects, so TasksPanel's own useQuery (same key) reads the already-errored cache
    // entry on mount instead of racing (or depending on) a real network failure.
    void client.prefetchQuery({
      queryKey: ["lead-tasks", "LD-26-DEMO-ERR"],
      queryFn: () => Promise.reject(new ApiError("The database is temporarily unavailable.", "tasks_failed", "TR-9F2A-40C2", 500)),
    });
    return client;
  });
  return (
    <QueryClientProvider client={qc}>
      <TasksPanel leadRef="LD-26-DEMO-ERR" today="2026-08-15" />
    </QueryClientProvider>
  );
}

// ── My Tasks (WP-TSK-5, N3C-03/C-60) ─────────────────────────────────────────
// design F-2: MyTasksList is the shared "My Tasks" list behind /tasks and /portal/tasks, and
// it had never had a gallery card — two consecutive WPs changed its behaviour with no place
// to see it. The seeded-QueryClient recipe is TasksPanelDemo's, one key over
// (["my-tasks", status, page], what the component's own useQuery reads).
//
// The pair below exists to show the ONE thing that is easy to misread in this component:
// the badge and the section headers report SERVER totals for the whole query, while the rows
// are this page's. `today` is pinned so the buckets never move.
const MY_TASKS_TODAY = "2026-08-15";
const myTask = (over: Partial<MyTask> & Pick<MyTask, "id" | "title">): MyTask => ({
  dueOn: null,
  assignedToUserId: "u1",
  authorUserId: "u1",
  authorRole: "admin",
  doneAt: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  assignee: DEMO_SELF,
  author: DEMO_SELF,
  leadRefId: "LD-26-00404",
  leadSeller: "Marcus Whitfield",
  leadCity: "Phoenix",
  leadState: "AZ",
  group: "none",
  ...over,
});
const MY_TASKS_PAGE_1: MyTask[] = [
  myTask({ id: "mt-1", title: "Call seller to schedule walkthrough", dueOn: "2026-08-13", group: "overdue" }),
  myTask({ id: "mt-2", title: "Send comps + preliminary offer range", dueOn: "2026-08-15", group: "today", leadRefId: "LD-26-00291", leadSeller: "Priya Raman", leadCity: "Mesa" }),
  myTask({ id: "mt-3", title: "Re-check MLS status before offer", dueOn: "2026-08-18", group: "upcoming", leadRefId: "LD-26-00318", leadSeller: "Dana Fields", leadCity: null, leadState: null }),
];

function myTasksClient(payload: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["me"], TASKS_DEMO_ME);
  client.setQueryData(["my-tasks", "open", 1], payload);
  return client;
}

/** Page 1 of a longer list: 4 overdue exist, only 1 is on this page. The badge reports the
 *  query total, the Overdue header reports 4 over a single row, and the muted line under the
 *  header accounts for the difference (pr-reviewer F-1). */
function MyTasksListDemo() {
  const [qc] = React.useState(() =>
    myTasksClient({
      items: MY_TASKS_PAGE_1,
      page: 1,
      pageSize: 3,
      total: 9,
      groupTotals: { overdue: 4, today: 2, upcoming: 3, none: 0 },
      today: MY_TASKS_TODAY,
    }),
  );
  return (
    <QueryClientProvider client={qc}>
      <MyTasksList leadHrefBase="/leads?open=" today={MY_TASKS_TODAY} />
    </QueryClientProvider>
  );
}

/** The same list when everything fits on one page: totals equal the rows, so the badge has a
 *  visible referent and the "on another page" line is absent entirely. */
function MyTasksListSinglePageDemo() {
  const [qc] = React.useState(() =>
    myTasksClient({
      items: MY_TASKS_PAGE_1,
      page: 1,
      pageSize: 20,
      total: 3,
      groupTotals: { overdue: 1, today: 1, upcoming: 1, none: 0 },
      today: MY_TASKS_TODAY,
    }),
  );
  return (
    <QueryClientProvider client={qc}>
      <MyTasksList leadHrefBase="/leads?open=" today={MY_TASKS_TODAY} title="My Tasks — single page" />
    </QueryClientProvider>
  );
}

const TIMELINE_DEMO: TimelineEntry[] = [
  { kind: "task_created", at: "2026-08-15T09:14:00.000Z", label: 'Task added — "Send comps + preliminary offer range"', actor: "faisal@example.com", title: "Send comps + preliminary offer range" },
  { kind: "note", at: "2026-08-14T16:02:00.000Z", label: "Note added", actor: "faisal@example.com", body: "Seller motivated — inherited from father's estate, wants a clean cash close before probate wraps." },
  { kind: "task_completed", at: "2026-08-13T11:20:00.000Z", label: "Task completed", actor: null, title: "Initial contact — left voicemail" },
  { kind: "status", at: "2026-08-12T14:41:00.000Z", label: "Status changed New → Contacted", actor: "faisal@example.com", status: "Contacted" },
  { kind: "assigned", at: "2026-08-12T09:00:00.000Z", label: "Assigned to Faisal", actor: null },
  { kind: "routed", at: "2026-08-12T08:00:00.000Z", label: "Routed to Cedar Ridge Capital (JV-004) · ZIP 85028", actor: null },
  { kind: "imported", at: "2026-08-12T07:58:00.000Z", label: "Imported from Lead Source 1 · run IM-25-112", actor: null },
];

export default function GalleryView() {
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
  // C-53: the standalone ScrollHint demo (the chip-strip shape it was extracted for).
  const { ref: chipScrollerRef, more: moreChipsRight } = useScrollHint();
  // WS-1 primitive demo state.
  const [dialogOpen, setDialogOpen] = React.useState(false);
  // FRM-02a discard-guard demo.
  const [dirtyDialogOpen, setDirtyDialogOpen] = React.useState(false);
  const [tallDialogOpen, setTallDialogOpen] = React.useState(false);
  const [dirtyDemoText, setDirtyDemoText] = React.useState("");
  // N5-01 SidePanel demos: the plain panel, the pager-in-the-leading-slot panel, and the
  // dirty one whose dismiss raises the shared DiscardGuard.
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [pagerPanelOpen, setPagerPanelOpen] = React.useState(false);
  const [dirtyPanelOpen, setDirtyPanelOpen] = React.useState(false);
  const [panelDemoText, setPanelDemoText] = React.useState("");
  const [panelDemoIndex, setPanelDemoIndex] = React.useState(3);
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

        <Section title="RoleBadge + AvatarInitials — the Team roster identity pair (Phase C)">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <RoleBadge role="owner" />
                <RoleBadge role="admin" />
                <RoleBadge role="member" />
                <RoleBadge role="viewer" />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-2">
                  <AvatarInitials email="priya.nair@example.com" size="md" />
                  <span className="text-sm text-text-2">md · from email</span>
                </span>
                <span className="inline-flex items-center gap-2">
                  <AvatarInitials name="Dana Whitfield" email="dana@example.com" size="sm" />
                  <span className="text-sm text-text-2">sm · from name</span>
                </span>
              </div>
              <p className="text-step-1 text-text-3">
                The pill always carries the role WORD, never the fill alone (PRN-14). The initials
                circle is <code className="num">aria-hidden</code> — every call site renders the identity
                as text beside it.
              </p>
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
              <p className="text-step-1 text-text-3">
                <strong className="font-semibold text-text-2">Hit target (C-52, WCAG 2.5.8):</strong> the chip draws 22px
                tall but reaches 28px — an invisible <code className="num">::before</code> adds 3px above and below, so
                nothing in the row moves. Vertical only, and exactly half the 6px chip gap: these strips wrap, and a
                taller hit area would steal taps from the line above. Same recipe on Checkbox (16→26px), the Dialog ✕
                (18→30px, 46px on coarse pointers), the tag colour swatches (16→24px) and the bell&apos;s Mark all read.
                All measured in the browser — absolute insets resolve against the PADDING box, so a bordered control
                reaches one pixel less per side than the utility reads.
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
                <Button
                  variant="secondary"
                  onClick={() => toast("Couldn't save Phone", "danger", { label: "Retry", onClick: () => toast("Retried", "success") })}
                >
                  Toast with a Retry action
                </Button>
              </div>
              <p className="text-step-1 text-text-3">
                Toasts auto-dismiss after {"~"}2.6s, but the countdown pauses while you hover or keyboard-focus
                the stack and each carries a ✕ to dismiss on demand (WCAG 2.2.1 Timing Adjustable). A toast
                carrying an action (N5-11) gets a longer window and dismisses itself when the action is taken.
                An action is only ever as alive as the thing that raised it, so a raiser that can go away
                first tags its toasts with a <code>scope</code> and calls <code>dismissScope</code> on unmount —
                a live-looking button wired to an unmounted component is worse than no button.
              </p>
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
                {/* Default: `as="div"` — block-level placeholders standing in for a label,
                    a headline number and a panel. */}
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-8 w-1/4" />
                <Skeleton className="h-24 w-full" />
                {/* C-51: `as="span"` is the PHRASING-CONTENT variant (renders inline-block).
                    Use it whenever the placeholder sits inside a <p>, <h1>-<h6>, <span>,
                    <label>, <a> or <button>: a <div> is invalid there, so the parser
                    relocates it and React reports a hydration mismatch. */}
                <p className="text-sm text-text-2">
                  Loading <Skeleton as="span" className="h-3 w-16 align-middle" /> leads in your territory.
                </p>
              </CardBody>
            </Card>
            {/* Compact variant — fills an embedded panel (e.g. a map that failed to load). */}
            <Card>
              <div className="h-40">
                <EmptyState compact title="Territory map unavailable." />
              </div>
            </Card>
            {/* C-54: the FILTERED-to-zero empty. Distinct from "nothing here yet" — the list is
                empty because of a choice the user made, so the empty state carries the way out. */}
            <Card>
              <EmptyState
                title="No leads found"
                description="Try widening the filters."
                action={<ClearFiltersButton onClick={() => toast("Filters cleared")} />}
              />
            </Card>
          </div>
          <p className="mt-3 text-step-1 text-text-3">
            <strong className="font-semibold text-text-2">ClearFiltersButton (C-54)</strong> — promoted at its 4th
            duplication (Activity, Leads, Unmatched, Imports; FRONTEND_STANDARDS §2). It belongs in the{" "}
            <code className="num">action</code> slot and only when filters are actually active: on a genuinely empty
            list there is nothing to clear, and a button that does nothing is worse than no button. DSN-03 states below;
            no <code className="num">loading</code> — clearing filters is synchronous local state (the FilterPill
            precedent for an n/a state).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ClearFiltersButton onClick={() => toast("Filters cleared")} />
            <ClearFiltersButton disabled onClick={() => toast("never fires")} />
            <ClearFiltersButton onClick={() => toast("Search cleared")}>Clear search</ClearFiltersButton>
            <span className="text-step-1 text-text-3">default · disabled · custom label</span>
          </div>
        </Section>

        <Section title="ScrollHint (C-53) — the right-edge fade on a horizontal scroller">
          <p className="mb-3 text-step-1 text-text-3">
            A phone has no resting scrollbar, so a clipped table or chip strip reads as amputated rather than
            scrollable. <code className="num">useScrollHint()</code> tracks whether content is still cut off to the
            right and <code className="num">ScrollHintFade</code> draws the fade; <code className="num">Table</code>{" "}
            wires both behind its <code className="num">scrollHint</code> prop. The fade is{" "}
            <code className="num">pointer-events-none</code> and <code className="num">aria-hidden</code> — it never
            eats a click and never announces. Not a color-only cue (PRN-14): it is a redundant affordance over content
            that stays reachable by scroll, swipe and the region&apos;s own keyboard focus.{" "}
            <code className="num">from</code> names the surface it dissolves into —{" "}
            <code className="num">&quot;surface&quot;</code> inside a Card (the default),{" "}
            <code className="num">&quot;bg&quot;</code> directly on the page background.
          </p>
          <div className="grid gap-3.5 md:grid-cols-2">
            {/* Pinned to a deliberately narrow width so the fade is visible on a desktop, not
                only on a phone: `min-w` wider than the host is exactly the condition scrollHint
                exists for. On the real pages the host is the viewport. */}
            <Card>
              <CardHeader><CardTitle>Table scrollHint · from=&quot;surface&quot;</CardTitle></CardHeader>
              <div className="max-w-[20rem]">
                <Table className="min-w-[560px]" ariaLabel="Scroll hint demo" scrollHint>
                  <THead>
                    <Tr>
                      <Th fit>Lead</Th>
                      <Th>Address</Th>
                      <Th>City</Th>
                      <Th fit>St</Th>
                      <Th fit align="right">ZIP</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {rows.slice(0, 3).map((l) => (
                      <Tr key={l.id}>
                        <Td fit className="num text-text-3">{l.id}</Td>
                        <Td>{l.addr}</Td>
                        <Td>{l.city}</Td>
                        <Td fit>{l.st}</Td>
                        <Td fit align="right" className="num">{l.zip}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
            {/* The standalone pieces, on the shape they were extracted for: the portal's mobile
                status-chip strip. The negative margin lives on the RELATIVE wrapper so the fade
                lands on the true bleed edge while the scroller keeps its own padding. */}
            <Card>
              <CardHeader><CardTitle>Chip strip · from=&quot;bg&quot;</CardTitle></CardHeader>
              <CardBody className="bg-bg">
                {/* Held to a phone-ish width for the same reason as the table above. */}
                <div className="relative -mx-4 max-w-[17rem]">
                  <div ref={chipScrollerRef} className="flex gap-1.5 overflow-x-auto px-4 pb-1">
                    {["All", "New", "Contacted", "Under contract", "Closed", "Dead"].map((s, i) => (
                      <FilterPill key={s} active={i === 0} className="shrink-0">{s}</FilterPill>
                    ))}
                  </div>
                  {moreChipsRight && <ScrollHintFade from="bg" />}
                </div>
                <p className="mt-3 text-step-1 text-text-3">
                  Scroll the strip: the fade disappears at the right end and comes back on the way in.
                </p>
              </CardBody>
            </Card>
          </div>
        </Section>

        <Section title="AuthCardHeader (C-63) — the one identity block on every auth card">
          <p className="mb-3 text-step-1 text-text-3">
            Login, signup, forgot, reset, verify, the public <code className="num">/terms</code> page and both ToS
            gates render this and nothing else for their heading. The <code className="num">&lt;h1&gt;</code> is the
            SCREEN&apos;S PURPOSE — the brand is context, not the task — and the product name is a muted eyebrow
            sibling read from <code className="num">lib/app</code> (PRN-12: never a literal). Before this the two
            login screens made the brand the <code className="num">h1</code> and the other four pages had no{" "}
            <code className="num">h1</code> at all. <code className="num">children</code> carries an optional
            supplementary line (the terms page&apos;s version stamp).
          </p>
          <div className="grid gap-3.5 md:grid-cols-2">
            <Card>
              <CardBody>
                <AuthCardHeader title="Admin portal sign-in" />
                <p className="text-step-1 text-text-3">Default — purpose + brand eyebrow.</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <AuthCardHeader title="Terms of Service &amp; Privacy Policy">
                  <span className="text-step-1 text-text-3">
                    Version <span className="num">2026-01-01</span>
                  </span>
                </AuthCardHeader>
                <p className="text-step-1 text-text-3">With a supplementary line.</p>
              </CardBody>
            </Card>
          </div>
        </Section>

        <Section title="SignOutLink (Q9) — the quiet way off a card with no app chrome">
          <p className="mb-3 text-step-1 text-text-3">
            Sits under the two ToS gates, which otherwise hide the whole app behind an accept button with no exit.
            Wraps <code className="num">useSignOut</code>, so the AUT-14 server revoke and the query-cache clear are
            the same ones the account menus use — <code className="num">redirectTo</code> is the caller&apos;s own login
            screen (<code className="num">/login</code> for admin, <code className="num">/portal/login</code> for the
            portal). DSN-03: default / hover / focus-visible / active / disabled-while-pending
            (&ldquo;Signing out…&rdquo;), on a <code className="num">min-h-11</code> target even though it reads as a
            text link.
          </p>
          <Card>
            <CardHeader><CardTitle>Live component, stubbed effect</CardTitle></CardHeader>
            <CardBody className="flex flex-col gap-2">
              {/* Gallery precedent (the Deactivate menu item above only toasts): the CHROME is
                  the real component so its states can be inspected, while the destructive
                  effect is stubbed. A capture-phase handler swallows the click before it
                  reaches the button — without it, browsing the gallery would sign you out. */}
              <div
                className="w-fit"
                onClickCapture={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toast("Sign-out is stubbed in the gallery.", "success");
                }}
              >
                <SignOutLink redirectTo="/login" />
              </div>
              <span className="text-step-1 text-text-3">
                Hover, tab to it, and hold the click to see all four resting states. Clicking does NOT sign you out
                here — on the real gates it does.
              </span>
            </CardBody>
          </Card>
        </Section>

        <Section title="Query error state — one failed-fetch surface (UXQ-01a)">
          <p className="mb-3 text-step-1 text-text-3">
            The single error state for a failed async data fetch: the server message, a mono{" "}
            <code className="num">Reference: &lt;traceId&gt;</code> line (so support can correlate — mirrors the
            crash boundary <code>error.tsx</code>), and a Retry where the query is refetchable. Carries{" "}
            <code className="num">role=&quot;status&quot;</code>. The compact variant fills an embedded panel.
          </p>
          <div className="grid gap-3.5 md:grid-cols-2">
            <Card>
              <QueryErrorState
                title="Couldn't load partners"
                error={new ApiError("The database is temporarily unavailable.", "db_unavailable", "TR-9F2A-40C1", 500)}
                onRetry={() => toast("Retrying…")}
              />
            </Card>
            <Card>
              <div className="h-40">
                <QueryErrorState
                  compact
                  title="Couldn't load your leads."
                  error={new ApiError("Request failed.", "upstream_error", "TR-77B3-1E9D", 502)}
                  onRetry={() => toast("Retrying…")}
                />
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
                <PartnerSelectDemo />
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
              <CardHeader>
                <CardTitle>RadioGroup (single-select; DSN-03, F-1)</CardTitle>
                <span className="text-xs text-text-3">role=radiogroup · tokened · a reveal can sit between items</span>
              </CardHeader>
              <CardBody>
                <RadioGroupDemo />
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
                <Button variant="secondary" size="sm" onClick={() => setDirtyDialogOpen(true)}>Open dirty-guard Dialog</Button>
                <Button variant="secondary" size="sm" onClick={() => setTallDialogOpen(true)}>Open tall Dialog (C-65)</Button>
                <RowOpenButton onClick={() => setDialogOpen(true)}>LD-26-00404</RowOpenButton>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>SidePanel (N5-01)</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-3">
                <p className="text-sm text-text-2">
                  Dialog&apos;s sibling, not a Dialog mode. From 768px it is NON-modal: no scrim, no focus trap,
                  the page behind stays visible AND clickable, and an outside click does not dismiss — try
                  clicking these buttons while it is open. Below 768px the same panel is a full-bleed sheet, and
                  there it IS modal (narrow the window and reopen). Esc and ✕ close either way; focus returns to
                  whatever opened it.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="secondary" size="sm" onClick={() => setPanelOpen(true)}>Open SidePanel</Button>
                  <Button variant="secondary" size="sm" onClick={() => setPagerPanelOpen(true)}>Open with header pager</Button>
                  <Button variant="secondary" size="sm" onClick={() => setDirtyPanelOpen(true)}>Open dirty-guard SidePanel</Button>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>InlineField (N5-10)</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-4">
                <p className="text-sm text-text-2">
                  A labelled value that edits where it sits — commit-on-blur, no save button. Hover or tab to
                  a field for the tint + pencil, click or press Enter to open it (the value arrives
                  pre-selected), Enter or clicking away commits, Esc reverts. The caller owns the request, the
                  optimistic paint and the rollback; the field owns only the interaction.
                </p>
                <InlineFieldDemo />
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Account menu trigger (WP-PP-6)</CardTitle></CardHeader>
              <CardBody className="flex flex-col gap-3">
                {/* Shared rail-foot trigger for the admin & portal account menus — normally
                    wrapped by DropdownMenuTrigger asChild; shown standalone here. */}
                <div className="max-w-[240px] rounded-md border border-border-soft p-1">
                  <AccountMenuTrigger email="jordan@meridianbuyers.com" role="partner" />
                </div>
                <div className="max-w-[240px] rounded-md border border-border-soft p-1">
                  <AccountMenuTrigger email="" />
                </div>
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

        <Section title="Listing-check badge (LST-03) — the label always carries words, never color alone">
          <Card>
            <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <ListingBadge status="pending" link={null} />
              <ListingBadge status="no" link={null} />
              <ListingBadge status="yes" link={null} />
              <ListingBadge status="unknown" link="https://example.com/verify" />
            </CardBody>
          </Card>
          <p className="mt-2 text-step-1 text-text-3">
            LinkOnly providers yield “Unknown — verify” plus a check link (PRN-14: the word carries the meaning, the
            Badge tone only reinforces it).
          </p>
        </Section>

        <Section title="Hot-lead mark (SCR / PRN-14) — meaning never rides on color">
          <Card>
            <CardBody className="flex flex-wrap items-center gap-x-8 gap-y-3">
              {[50, 44, 38].map((s) => (
                <span key={s} className="inline-flex items-center gap-2">
                  <HotLeadMark score={s} />
                  <span className="num text-step-1 text-text-3">LD-26-004{s} · {s}/50</span>
                </span>
              ))}
              <span className="inline-flex items-center gap-2 text-text-3">
                <HotLeadIcon />
                <span className="text-step-1">bare icon — decorative (aria-hidden)</span>
              </span>
            </CardBody>
          </Card>
          <p className="mt-2 text-step-1 text-text-3">
            Amber target glyph + an aria-label carrying the score; rendered ONLY for a kept hot lead (Hot floor 38/50)
            and always beside the reference ID.
          </p>
        </Section>

        <Section title="State multi-select (WP-C) — searchable whole-state coverage">
          <Card>
            <CardBody className="max-w-md">
              <StateMultiSelectDemo />
            </CardBody>
          </Card>
        </Section>

        <Section title="Clamped text (DSN-03) — long notes collapse; the toggle shows only on overflow">
          <div className="grid gap-3.5 md:grid-cols-2">
            <Card>
              <CardBody>
                <p className="mb-2 text-step-1 font-semibold text-text-3">Short — reads as plain text, no toggle</p>
                <ClampedText>Motivated seller, needs a quick close. Cash preferred.</ClampedText>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="mb-2 text-step-1 font-semibold text-text-3">Long — clamps to 3 lines + Show more</p>
                <ClampedText lines={3}>{LONG_NOTE}</ClampedText>
              </CardBody>
            </Card>
          </div>
        </Section>

        <Section title="Portal devices (ACC-02) — remembered devices, two-step revoke">
          <Card>
            <CardBody>
              <PortalDevicesDemo />
            </CardBody>
          </Card>
          <p className="mt-2 text-step-1 text-text-3">
            Renders inner content only — the caller frames it. “Sign out” reveals a confirm step before revoking so a
            partner can’t sign out a device (maybe the one they’re on) with one stray click (P-12).
          </p>
        </Section>

        <Section title="Tasks panel + Timeline (WP-TSK-4) — per-lead work items and the unified activity feed">
          <p className="mb-3 text-step-1 text-text-3">
            Both panels own their own data fetching (TanStack Query), exactly as they do in the admin and portal
            lead dialogs — each demo below seeds an isolated QueryClient (the Portal devices pattern above) so the
            gallery stays a static showcase on load. Checkbox/delete/add clicks still fire a real request; a
            failure in this dev-only page just surfaces the panel’s own toast or error line. Delete is a two-click
            inline confirm (“Delete” → “Confirm · Cancel”); Timeline’s four filter chips are fully interactive.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-step-1 font-semibold text-text-3">Open + done — overdue / due today / upcoming / done</p>
              <TasksPanelDemo />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-step-1 font-semibold text-text-3">Empty</p>
              <TasksPanelEmptyDemo />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-step-1 font-semibold text-text-3">Error</p>
              <TasksPanelErrorDemo />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-step-1 font-semibold text-text-3">Timeline — All / Tasks / Notes / Status filters</p>
              <Timeline activity={TIMELINE_DEMO} />
            </div>
          </div>
        </Section>

        <Section title="My Tasks (WP-TSK-5 · N3C-03/C-60) — the shared /tasks + /portal/tasks list">
          <p className="mb-3 text-step-1 text-text-3">
            One component behind both the admin and partner task pages. The number beside the badge and on each
            section header is a SERVER total for the whole query; the rows underneath are only the page you are on.
            The pair below is that distinction: on the left, four overdue tasks exist and one is on this page, so a
            muted line accounts for the other three; on the right everything fits on one page and the line is gone.
            <code className="ml-1 rounded bg-surface-3 px-1">today</code> is pinned to {MY_TASKS_TODAY} so the
            buckets never move under you.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-step-1 font-semibold text-text-3">Page 1 of a longer list — totals outrun the page</p>
              <MyTasksListDemo />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-step-1 font-semibold text-text-3">Single page — totals equal the rows</p>
              <MyTasksListSinglePageDemo />
            </div>
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
                  {/* AIS-10: the same component re-headed as the post-answer follow-up row —
                      bounded to 3, shown under the last answer while the widget is idle. */}
                  <p className="mb-2 text-step-1 text-text-3">Follow-up variant — under the last answer:</p>
                  <SuggestionChips
                    items={["Which states have no coverage?", "Explain this screen"]}
                    onSelect={() => {}}
                    heading="Ask next"
                    label="Follow-up questions"
                  />
                </div>
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

      {/* FRM-02a (F-6): confirmClose guards Esc/backdrop/✕ once the form is dirty. Type
          something, then press Esc or click the ✕ — a discard-confirmation intercepts it.
          The explicit "Save" closes directly; a pristine form is never guarded. */}
      <Dialog
        open={dirtyDialogOpen}
        onClose={() => { setDirtyDialogOpen(false); setDirtyDemoText(""); }}
        confirmClose={dirtyDemoText.trim().length > 0}
        title="Edit partner PR-003"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDirtyDialogOpen(false); setDirtyDemoText(""); }}>Cancel</Button>
            <Button variant="primary" onClick={() => { setDirtyDialogOpen(false); setDirtyDemoText(""); toast("Saved", "success"); }}>Save changes</Button>
          </>
        }
      >
        <Input
          label="Deal terms"
          value={dirtyDemoText}
          onChange={(e) => setDirtyDemoText(e.target.value)}
          placeholder="Type here, then press Esc"
          hint="With text present, Esc/backdrop/✕ asks before discarding (FRM-02a)."
        />
      </Dialog>

      {/* C-65 (N3C-11): the title bar and the footer sit OUTSIDE the scrolling region, so a
          tall dialog can never scroll away its own identity or its primary action. Scroll the
          body: a bottom edge-fade (the shared ScrollHint recipe, vertical axis) shows while
          content is still cut off below and disappears at the end. */}
      <Dialog
        open={tallDialogOpen}
        onClose={() => setTallDialogOpen(false)}
        title="Lead LD-26-00404 — pinned title + scroll cue"
        footer={<Button variant="primary" onClick={() => setTallDialogOpen(false)}>Done</Button>}
      >
        <div className="flex flex-col gap-3">
          {Array.from({ length: 20 }).map((_, i) => (
            <p key={i} className="text-sm text-text-2">
              Row {i + 1} — the header above and the footer below stay put while this text scrolls.
            </p>
          ))}
        </div>
      </Dialog>

      {/* N5-01: the plain panel. `statusMessage` is the persistent polite live region every
          SidePanel carries (A11Y-03) — the panel does not move focus when its record changes,
          so the announcement is the only thing a screen reader gets. */}
      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="LD-26-00404"
        statusMessage={panelOpen ? "Now showing lead LD-26-00404" : ""}
      >
        <p className="text-sm text-text-2">
          The record content goes here. The table behind is still live — that is the whole point of the primitive.
        </p>
      </SidePanel>

      {/* N5-04: the `leading` slot, before the title — where the lead pager lives. The arrows are
          the shared ARROW_BUTTON_CLASS recipe (Pagination), with a real `disabled` at the ends
          because that is a DATA boundary, not a permission miss. */}
      <SidePanel
        open={pagerPanelOpen}
        onClose={() => setPagerPanelOpen(false)}
        title={`LD-26-0040${panelDemoIndex}`}
        statusMessage={pagerPanelOpen ? `Now showing lead LD-26-0040${panelDemoIndex}` : ""}
        leading={
          <div role="group" aria-label="Lead navigation" className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={ARROW_BUTTON_CLASS}
              aria-label="Previous lead"
              disabled={panelDemoIndex <= 1}
              onClick={() => setPanelDemoIndex((i) => i - 1)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <span className="num px-0.5 text-step-1 tabular-nums text-text-3">{panelDemoIndex} of 5</span>
            <button
              type="button"
              className={ARROW_BUTTON_CLASS}
              aria-label="Next lead"
              disabled={panelDemoIndex >= 5}
              onClick={() => setPanelDemoIndex((i) => i + 1)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        }
      >
        <p className="text-sm text-text-2">
          Step the pager: the panel switches record IN PLACE (no close/reopen), and only the live region&apos;s
          text changes — focus deliberately stays where it is.
        </p>
      </SidePanel>

      {/* FRM-02a: the same discard guard Dialog raises, from the shared DiscardGuard. Type
          something, then press Esc or click ✕. Inside the non-modal panel the guard also holds
          Tab between Keep/Discard and makes the covered header + body inert — there is no outer
          focus trap here to fall back on. */}
      <SidePanel
        open={dirtyPanelOpen}
        onClose={() => { setDirtyPanelOpen(false); setPanelDemoText(""); }}
        confirmClose={panelDemoText.trim().length > 0}
        title="LD-26-00404 — unsaved edits"
      >
        <Input
          label="Source notes"
          value={panelDemoText}
          onChange={(e) => setPanelDemoText(e.target.value)}
          placeholder="Type here, then press Esc"
          hint="With text present, Esc/✕ asks before discarding (FRM-02a)."
        />
      </SidePanel>

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

/** `renderValue` (N5-06): the trigger paints the SELECTED value as something richer than the
 *  option's text — here the partner swatch + name + JV ref (PRN-14: the color never travels
 *  alone). The option LIST stays plain text, which is what Radix's typeahead reads.
 *
 *  ⚠️ `ariaLabel` REPLACES the accessible name Radix builds from the selected item, so a
 *  control using `renderValue` composes the current value INTO its label — otherwise the
 *  trigger announces its purpose and never its value (WCAG 4.1.2). */
function PartnerSelectDemo() {
  const PARTNERS = [
    { id: "p1", name: "Bluebird Home Buyers", refId: "PR-26-014" },
    { id: "p2", name: "Josh Ax", refId: "PR-003" },
  ];
  const [partnerId, setPartnerId] = React.useState("p1");
  const current = PARTNERS.find((p) => p.id === partnerId)!;
  return (
    <div className="flex max-w-xs flex-col gap-1.5">
      <p className="text-step-1 text-text-3">
        <code>renderValue</code> — the trigger paints the partner swatch; the accessible name
        carries the same name + ref.
      </p>
      <Select
        // No visible `label` here on purpose: this is the lead record's control (N5-06),
        // where the swatch IS the label and the name has to be composed by hand.
        ariaLabel={`Assigned partner: ${current.name} (${current.refId})`}
        value={partnerId}
        onValueChange={setPartnerId}
        renderValue={() => <PartnerTag size="sm" name={current.name} color={colorOf(current.name)} refId={current.refId} />}
        options={PARTNERS.map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` }))}
      />
    </div>
  );
}

/** The InlineField state matrix, live (§6.17): a real editable field, a field mid-save, a
 *  disabled one, a never-editable one, and the boxed multiline variant. */
function InlineFieldDemo() {
  const [phone, setPhone] = React.useState("(918) 555-0164");
  const [state, setState] = React.useState("OK");
  const [notes, setNotes] = React.useState("Roof replaced 2019. Tenant in place through October.");
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-lg border border-border-soft p-4 sm:grid-cols-3">
      <InlineField label="Phone" value={phone} onCommit={setPhone} hint />
      <InlineField label="State" value={state} onCommit={setState} mask={(raw) => raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2)} />
      <InlineField label="Email" value="m.ellery@example.test" onCommit={() => {}} saving />
      <InlineField label="ZIP" value="74105" onCommit={() => {}} disabled />
      <InlineField label="Received" value="Aug 18, 2:12 PM" onCommit={() => {}} editable={false} />
      <InlineField label="Time to sell" value="" onCommit={() => {}} />
      <InlineField label="Source notes" value={notes} onCommit={setNotes} multiline className="col-span-2 sm:col-span-3" />
    </div>
  );
}
