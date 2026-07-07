import { describe, it, expect, vi } from "vitest";
import {
  withIdempotency,
  InMemoryIdempotencyStore,
  RequestInProgressError,
} from "@/lib/idempotency";
import { InMemoryProcessingQueue } from "@/modules/pipeline/lock";

describe("API-03: idempotency", () => {
  it("runs work once and replays the stored response on retry", async () => {
    const store = new InMemoryIdempotencyStore<number>();
    const work = vi.fn(async () => 42);

    const first = await withIdempotency(store, "up-1", work);
    expect(first).toEqual({ replayed: false, response: 42 });

    const retry = await withIdempotency(store, "up-1", work);
    expect(retry).toEqual({ replayed: true, response: 42 });
    expect(work).toHaveBeenCalledTimes(1); // never double-processed
  });

  it("rejects a concurrent request already in progress", async () => {
    const store = new InMemoryIdempotencyStore<number>();
    const work = vi.fn(async () => 1);
    store.claim("up-2"); // simulate an in-flight request holding the key
    await expect(withIdempotency(store, "up-2", work)).rejects.toBeInstanceOf(RequestInProgressError);
    expect(work).not.toHaveBeenCalled();
  });
});

describe("ING-06: per-tenant processing lock", () => {
  it("acquires the first run and queues the rest with visible positions", () => {
    const q = new InMemoryProcessingQueue();
    expect(q.claim("t1", "u1")).toEqual({ status: "acquired" });
    expect(q.claim("t1", "u2")).toEqual({ status: "queued", position: 1 });
    expect(q.claim("t1", "u3")).toEqual({ status: "queued", position: 2 });
  });

  it("is isolated per tenant", () => {
    const q = new InMemoryProcessingQueue();
    q.claim("t1", "u1");
    expect(q.claim("t2", "u1")).toEqual({ status: "acquired" });
  });

  it("promotes the next queued run on release", () => {
    const q = new InMemoryProcessingQueue();
    q.claim("t1", "u1");
    q.claim("t1", "u2");
    q.claim("t1", "u3");
    q.release("t1", "u1");
    expect(q.activeUpload("t1")).toBe("u2");
    // u3 is now first in line.
    expect(q.claim("t1", "u4")).toEqual({ status: "queued", position: 2 });
  });

  it("treats a re-claim of the active run as idempotent", () => {
    const q = new InMemoryProcessingQueue();
    q.claim("t1", "u1");
    expect(q.claim("t1", "u1")).toEqual({ status: "acquired" });
  });
});
