import { describe, expect, it } from "vitest";
import { exportStoragePath, EXPORTS_BUCKET } from "@/modules/export/storage";

// EXP-05: deterministic private-bucket path for a run's stored deliverable.
describe("exportStoragePath", () => {
  it("EXP-05: namespaces the file by tenant then run reference", () => {
    expect(exportStoragePath("tenant-abc", "UP-2026-014")).toBe("tenant-abc/UP-2026-014.xlsx");
  });

  it("EXP-05: the bucket is a single private bucket name", () => {
    expect(EXPORTS_BUCKET).toBe("run-exports");
  });
});
