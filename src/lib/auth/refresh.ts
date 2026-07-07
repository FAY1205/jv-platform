import { randomBytes } from "node:crypto";
import { sha256Hex } from "./hash";

// AUT-10: trusted-device sessions use rotating refresh tokens with reuse detection.
// Presenting an already-rotated token means it leaked → revoke the whole family and
// notify. 30-day absolute cap. Backs the per-device session registry (ACC-02).
// Logout (AUT-14) revokes families server-side. Modeled over an injectable store so
// the logic is unit-tested here; the Postgres-backed store lands with the auth routes.

export const REFRESH_ABSOLUTE_MS = 30 * 24 * 3_600_000; // 30 days

export interface RefreshRecord {
  id: string;
  familyId: string;
  tokenHash: string;
  issuedAt: number;
  expiresAt: number;
  /** Set when this token has been rotated to a successor (so re-presenting = reuse). */
  rotatedTo?: string;
  revokedAt?: number;
}

export interface RefreshStore {
  getByHash(hash: string): RefreshRecord | undefined;
  save(rec: RefreshRecord): void;
  family(familyId: string): RefreshRecord[];
}

export class InMemoryRefreshStore implements RefreshStore {
  private byId = new Map<string, RefreshRecord>();
  getByHash(hash: string) {
    return [...this.byId.values()].find((r) => r.tokenHash === hash);
  }
  save(rec: RefreshRecord) {
    this.byId.set(rec.id, rec);
  }
  family(familyId: string) {
    return [...this.byId.values()].filter((r) => r.familyId === familyId);
  }
}

export type RotateResult =
  | { status: "rotated"; token: string; record: RefreshRecord }
  | { status: "reuse_revoked"; familyId: string }
  | { status: "invalid" };

export class RefreshTokenService {
  constructor(
    private store: RefreshStore,
    private idgen: () => string,
  ) {}

  issue(now: number, familyId?: string): { token: string; record: RefreshRecord } {
    const token = randomBytes(32).toString("base64url");
    const record: RefreshRecord = {
      id: this.idgen(),
      familyId: familyId ?? this.idgen(),
      tokenHash: sha256Hex(token),
      issuedAt: now,
      expiresAt: now + REFRESH_ABSOLUTE_MS,
    };
    this.store.save(record);
    return { token, record };
  }

  rotate(presented: string, now: number): RotateResult {
    const rec = this.store.getByHash(sha256Hex(presented));
    if (!rec || rec.revokedAt != null) return { status: "invalid" };
    // Reuse: an already-rotated token is presented again → the family is compromised.
    if (rec.rotatedTo != null) {
      this.revokeFamily(rec.familyId, now);
      return { status: "reuse_revoked", familyId: rec.familyId };
    }
    if (now > rec.expiresAt) return { status: "invalid" };
    const next = this.issue(now, rec.familyId);
    rec.rotatedTo = next.record.id;
    this.store.save(rec);
    return { status: "rotated", token: next.token, record: next.record };
  }

  /** Revoke every token in a family (reuse response, or logout — AUT-14). */
  revokeFamily(familyId: string, now: number): void {
    for (const r of this.store.family(familyId)) {
      r.revokedAt = now;
      this.store.save(r);
    }
  }
}
