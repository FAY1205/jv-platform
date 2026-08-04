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
  row({ Address: "1 A St", State: "NJ", Zip: "08034" }),
  row({ Address: "2 B St", State: "SC", Zip: "29601" }),
];

const PARTNERS = new Map<string, PartnerInfo>([
  ["p-josh", { id: "p-josh", name: "Josh Ax", refId: "JV-003", color: "#8fbfe8" }],
  ["p-randy", { id: "p-randy", name: "Randy Wolfe", refId: "JV-006", color: "#e8927c" }],
]);

class FakeStore implements RunStore {
  persisted: PersistRunInput | null = null;
  constructor(private partners: Map<string, PartnerInfo>) {}
  async loadPartners() {
    return this.partners;
  }
  async persistRun(input: PersistRunInput): Promise<PersistRunResult> {
    this.persisted = input;
    return {
      uploadId: "u1",
      uploadRefId: "IM-26-001",
      leadRefIds: input.leads.map((_, i) => `LD-26-${String(i + 1).padStart(5, "0")}`),
    };
  }
}

const deps = (store: RunStore) => ({ store, clock: () => CLOCK });

describe("WP-017: processRun orchestrates plan → stamp → persist → export", () => {
  it("persists every lead and returns the upload ref + summary", async () => {
    const store = new FakeStore(PARTNERS);
    const result = await processRun(
      { tenantId: "t1", filename: "week.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(result.uploadRefId).toBe("IM-26-001");
    expect(store.persisted!.leads).toHaveLength(2);
    expect(result.summary.total).toBe(2);
  });

  it("stamps first_matched_at with the injected clock for every lead (PRN-01)", async () => {
    const store = new FakeStore(PARTNERS);
    await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(store.persisted!.leads[0].firstMatchedAt).toBe(CLOCK);
    expect(store.persisted!.leads[1].firstMatchedAt).toBe(CLOCK);
  });

  it("ADR-0038: duplicate rows all persist — repeats are not collapsed against history or within the run", async () => {
    const store = new FakeStore(PARTNERS);
    const result = await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: [ROWS[0], ROWS[0], ROWS[1]], profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(store.persisted!.leads).toHaveLength(3);
    // Both copies of the repeated house route by the CURRENT coverage and are stamped now.
    expect(store.persisted!.leads[0].partnerId).toBe("p-josh");
    expect(store.persisted!.leads[1].partnerId).toBe("p-josh");
    expect(result.summary.total).toBe(3);
  });

  it("ING-07: a saved profile's uuid id and version are passed to the store for the upload row", async () => {
    const store = new FakeStore(PARTNERS);
    const saved = { ...GENERIC_PROFILE, id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", version: 4 };
    await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: saved, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(store.persisted!.sourceProfileId).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(store.persisted!.sourceProfileVersion).toBe(4);
  });

  it("ING-07: a seed profile's slug id is nulled so it never reaches the uuid column", async () => {
    const store = new FakeStore(PARTNERS);
    await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    // "generic" is not a uuid — the FK stays null, but the version still pins the format.
    expect(GENERIC_PROFILE.id).toBe("generic");
    expect(store.persisted!.sourceProfileId).toBeNull();
    expect(store.persisted!.sourceProfileVersion).toBe(GENERIC_PROFILE.version);
  });

  it("ADR-0038: the file's content hash reaches the persisted upload row (duplicate-file warn)", async () => {
    const store = new FakeStore(PARTNERS);
    await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true, contentHash: "a".repeat(64) },
      deps(store),
    );
    expect(store.persisted!.contentHash).toBe("a".repeat(64));
  });

  it("ADR-0038: a missing content hash persists as null (older clients)", async () => {
    const store = new FakeStore(PARTNERS);
    await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(store.persisted!.contentHash).toBeNull();
  });

  it("DM-08: attaches a rules hash to the persisted upload", async () => {
    const store = new FakeStore(PARTNERS);
    await processRun(
      { tenantId: "t1", filename: "w.xlsx", rows: ROWS, profile: GENERIC_PROFILE, rules: RULES, snapshotInput: SNAPSHOT_INPUT, year: 2026, colorCoding: true },
      deps(store),
    );
    expect(store.persisted!.rulesHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("renders an export of the DELIVERED (kept) leads with the assigned partner", async () => {
    const store = new FakeStore(PARTNERS);
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
