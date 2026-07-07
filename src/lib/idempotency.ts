// API-03: idempotency keys on upload and job routes — a retried request never
// double-processes. Modeled over an injectable store (in-memory for tests; the
// idempotency_keys table backs it in production).

export type IdempotencyStatus = "in_progress" | "completed";

export interface IdempotencyRecord<T> {
  key: string;
  status: IdempotencyStatus;
  response?: T;
}

export interface IdempotencyStore<T> {
  get(key: string): IdempotencyRecord<T> | undefined;
  /** Atomically claim a key; returns false if it already exists. */
  claim(key: string): boolean;
  complete(key: string, response: T): void;
}

export class InMemoryIdempotencyStore<T> implements IdempotencyStore<T> {
  private map = new Map<string, IdempotencyRecord<T>>();
  get(key: string) {
    return this.map.get(key);
  }
  claim(key: string) {
    if (this.map.has(key)) return false;
    this.map.set(key, { key, status: "in_progress" });
    return true;
  }
  complete(key: string, response: T) {
    this.map.set(key, { key, status: "completed", response });
  }
}

export class RequestInProgressError extends Error {
  constructor() {
    super("A request with this idempotency key is already in progress.");
    this.name = "RequestInProgressError";
  }
}

/**
 * Run `work` at most once per key. A replay of a completed key returns the stored
 * response without re-running; a replay while still in progress is rejected.
 */
export async function withIdempotency<T>(
  store: IdempotencyStore<T>,
  key: string,
  work: () => Promise<T>,
): Promise<{ replayed: boolean; response: T }> {
  const existing = store.get(key);
  if (existing?.status === "completed") {
    return { replayed: true, response: existing.response as T };
  }
  if (existing?.status === "in_progress") throw new RequestInProgressError();

  if (!store.claim(key)) {
    // Lost a race between get() and claim(); re-read.
    const now = store.get(key);
    if (now?.status === "completed") return { replayed: true, response: now.response as T };
    throw new RequestInProgressError();
  }

  const response = await work();
  store.complete(key, response);
  return { replayed: false, response };
}
