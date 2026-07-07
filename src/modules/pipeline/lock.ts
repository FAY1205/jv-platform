// ING-06: one pipeline run at a time per tenant; concurrent uploads queue with a
// visible position. Interleaved runs could corrupt dedupe ordering, so the run is
// serialized per tenant. This in-memory queue models the semantics (and is unit
// tested); production serializes the claim-and-set with a per-tenant Postgres
// advisory lock (pg_advisory_xact_lock) inside the upload route's transaction —
// wired in Phase 1 where that transaction lives.

export type ClaimResult = { status: "acquired" } | { status: "queued"; position: number };

export interface ProcessingQueue {
  claim(tenantId: string, uploadId: string): ClaimResult;
  release(tenantId: string, uploadId: string): void;
  activeUpload(tenantId: string): string | undefined;
}

export class InMemoryProcessingQueue implements ProcessingQueue {
  private active = new Map<string, string>();
  private queues = new Map<string, string[]>();

  claim(tenantId: string, uploadId: string): ClaimResult {
    if (this.active.get(tenantId) === uploadId) return { status: "acquired" };
    if (!this.active.has(tenantId)) {
      this.active.set(tenantId, uploadId);
      return { status: "acquired" };
    }
    const q = this.queues.get(tenantId) ?? [];
    if (!q.includes(uploadId)) q.push(uploadId);
    this.queues.set(tenantId, q);
    return { status: "queued", position: q.indexOf(uploadId) + 1 };
  }

  release(tenantId: string, uploadId: string): void {
    if (this.active.get(tenantId) === uploadId) {
      const q = this.queues.get(tenantId) ?? [];
      const next = q.shift();
      if (next) {
        this.active.set(tenantId, next);
        this.queues.set(tenantId, q);
      } else {
        this.active.delete(tenantId);
      }
      return;
    }
    const q = this.queues.get(tenantId) ?? [];
    const i = q.indexOf(uploadId);
    if (i >= 0) q.splice(i, 1);
    this.queues.set(tenantId, q);
  }

  activeUpload(tenantId: string): string | undefined {
    return this.active.get(tenantId);
  }
}
