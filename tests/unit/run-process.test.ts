import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  processRun,
  type RunStore,
  type PersistRunInput,
  type PersistRunResult,
} from "@/modules/run/process";
import { GENERIC_PROFILE } from "@/modules/sources";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import { buildCoverage } from "@/modules/pipeline/assign";
import type { HistoryEntry } from "@/modules/pipeline/dedupe";
import type { PartnerInfo } from "@/modules/export/render";

const CLOCK = "2026-07-08T12:00:00.000Z";

const RULES = {
  mlsPatterns: DEFAULT_MLS_PATTERNS,
  coverage: buildCoverage([], [
    { state: "NJ", partnerId: "p-josh" },
    { state: "SC", partnerId: "p-randy" },
  ]),
};
const SNAPSHOT_INPUT = {
  sourceProfile: { id: GENERIC_PROFILE.id, version: GENERIC_PROFILE.version },
  mlsPatterns: DEFAULT_MLS_PATTERNS,
  stateRules: [
    { state: "NJ", partnerId: "p-josh" },
    { state: "SC", partnerId: "p-randy" },
  ],
  zipCoverage: [],
};

function row(over: Record<string, string>): Record<string, string> {
  return {
    Campaign: "Lead Zolo 1.0",
    "Date Created": "2026-07-06",
    Notes: "off market",
    Address: "1 A St",
    City: "Town",
    State: "NJ",
    Zip: "08034",
    "Seller First Name": "A",
    "Seller Last Name": "B",
    Phone: "(856) 555-0100",
    Email: "a@example.test",
    "Reason For Selling": "x",
    Motivation: "y",
    "Time to Sell": "z",
    ...over,
  };
}
const ROWS = [
  row({ Address: "1 A St", State: "NJ", Zip: "08034" }), // new → stamped now
  row({ Address: "2 B St", State: "SC", Zip: "29601" }), // in history → prev-matched
];

const PARTNERS = new Map<string, PartnerInfo>([
  ["p-josh", { id: "p-josh", name: "Josh Ax", refId: "JV-003", color: "#8fbfe8" }],
  ["p-randy", { id: "p-randy", name: "Randy Wolfe", refId: "JV-006", color: "#e8927c" }],
  ["p-original", { id: "p-original", name: "First Partner", refId: "JV-001", color: "#f4c95d" }],
]);

class FakeStore implements RunStore {
  persisted: PersistRunInput | null = null;
  constructor(
    private history: Map<string, HistoryEntry>,
    private partners: Map<string, PartnerInfo>,
  ) {}
  async loadHistory() {
    return this.history;
  }
  async loadPartners() {
    return this.partners;
  }
  async persistRun(input: PersistRunInput): Promise<PersistRunResult> {
    this.persisted = input;
    return {
      uploadId: "u1",
      uploadRefId: "UP-2026-001",
      leadRefIds: input.leads.map((_, i) => `LD-2026-${String(i + 1).padStart(5, "0")}`),
    };
  }
}

const deps = (store: RunStore) => ({ store, clock: () => CLOCK });

describe("WP-017: processRun orchestrates history → plan → stamp → persist → export", () => {
  it("persists every lead (DED-03) and returns the upload ref + summary", async () => {
    const store = new FakeStore(new Map(), PARTNERS);
    const result = await processRun(
      { tenantId: "t1", filename: "week.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(result.uploadRefId).toBe("UP-2026-001");
    expect(store.persisted!.leads).toHaveLength(2);
    expect(result.summary.total).toBe(2);
  });

  it("stamps first_matched_at with the injected clock for new leads (PRN-01)", async () => {
    const store = new FakeStore(new Map(), PARTNERS);
    await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(store.persisted!.leads[0].firstMatchedAt).toBe(CLOCK);
  });

  it("PRN-05: a previously-matched lead keeps the historical first_matched_at + original partner", async () => {
    const history = new Map<string, HistoryEntry>([
      ["2 b st|29601", { partnerId: "p-original", matchMethod: "zip", firstMatchedAt: "2026-05-01T00:00:00.000Z", phoneNorm: "8565550100" }],
    ]);
    const store = new FakeStore(history, PARTNERS);
    await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(store.persisted!.leads[1]).toMatchObject({
      previouslyMatched: true,
      partnerId: "p-original",
      firstMatchedAt: "2026-05-01T00:00:00.000Z",
    });
  });

  it("DM-08: attaches a rules hash to the persisted upload", async () => {
    const store = new FakeStore(new Map(), PARTNERS);
    await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(store.persisted!.rulesHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("renders an export of the DELIVERED (kept) leads with the assigned partner", async () => {
    const store = new FakeStore(new Map(), PARTNERS);
    const result = await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(result.exportBytes.byteLength).toBeGreaterThan(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.exportBytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.getWorksheet("Leads")!;
    const partnerCol = 17;
    const labels: string[] = [];
    ws.eachRow((r, n) => {
      if (n > 1 && String(r.getCell(1).value ?? "").startsWith("LD-")) {
        labels.push(String(r.getCell(partnerCol).value ?? ""));
      }
    });
    // Both leads are kept: NJ→Josh Ax, SC→Randy Wolfe.
    expect(labels).toContain("Josh Ax (JV-003)");
    expect(labels).toContain("Randy Wolfe (JV-006)");
  });
});
