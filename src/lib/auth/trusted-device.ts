import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { sha256Hex } from "./hash";
import {
  InMemoryRefreshStore,
  RefreshTokenService,
  type RefreshRecord,
  type RotateResult,
} from "./refresh";

// AUT-10 / ACC-02: trusted-device credential backed by the trusted_devices table.
// The rotation + reuse-detection engine is the built RefreshTokenService (refresh.ts,
// unit-tested with an in-memory store); this class bridges it to Postgres via a
// hydrate → operate → flush pattern so the tested logic is reused verbatim.

type DB = PostgresJsDatabase<typeof schema>;

export interface DeviceContext {
  tenantId: string;
  userId: string;
  partnerId: string | null;
  deviceLabel: string | null;
  ip: string | null;
}

type Row = typeof schema.trustedDevices.$inferSelect;

function toRecord(row: Row): RefreshRecord {
  return {
    id: row.id,
    familyId: row.familyId,
    tokenHash: row.tokenHash,
    issuedAt: row.issuedAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    rotatedTo: row.rotatedTo ?? undefined,
    revokedAt: row.revokedAt ? row.revokedAt.getTime() : undefined,
  };
}

export interface RotateOutcome {
  result: RotateResult;
  /** The device owner's email (to establish a session / notify), when resolvable. */
  email?: string;
}

export class TrustedDeviceService {
  constructor(
    private db: DB,
    private idgen: () => string = () => globalThis.crypto.randomUUID(),
  ) {}

  /** Issue a new trusted-device family. Returns the plaintext token (cookie value). */
  async issue(ctx: DeviceContext, now: number): Promise<{ token: string; familyId: string }> {
    const svc = new RefreshTokenService(new InMemoryRefreshStore(), this.idgen);
    const { token, record } = svc.issue(now); // 30-day absolute expiry (AUT-10)
    await this.db.insert(schema.trustedDevices).values({
      id: record.id,
      familyId: record.familyId,
      tokenHash: record.tokenHash,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      partnerId: ctx.partnerId,
      deviceLabel: ctx.deviceLabel,
      ip: ctx.ip,
      issuedAt: new Date(record.issuedAt),
      expiresAt: new Date(record.expiresAt),
      lastSeenAt: new Date(now),
    });
    return { token, familyId: record.familyId };
  }

  /**
   * Rotate a presented token. Reuse of an already-rotated token revokes the whole
   * family (AUT-10). On success the successor is persisted with the family's device
   * context; the result carries the new token.
   */
  async rotate(presented: string, now: number, ip: string | null): Promise<RotateOutcome> {
    const T = schema.trustedDevices;
    const [row] = await this.db.select().from(T).where(eq(T.tokenHash, sha256Hex(presented)));
    if (!row) return { result: { status: "invalid" } };

    const familyRows = await this.db.select().from(T).where(eq(T.familyId, row.familyId));
    const mem = new InMemoryRefreshStore();
    for (const r of familyRows) mem.save(toRecord(r));
    const result = new RefreshTokenService(mem, this.idgen).rotate(presented, now);

    if (result.status === "reuse_revoked") {
      await this.db.update(T).set({ revokedAt: new Date(now) }).where(eq(T.familyId, row.familyId));
    } else if (result.status === "rotated") {
      await this.db.update(T).set({ rotatedTo: result.record.id, lastSeenAt: new Date(now) }).where(eq(T.id, row.id));
      await this.db.insert(T).values({
        id: result.record.id,
        familyId: result.record.familyId,
        tokenHash: result.record.tokenHash,
        tenantId: row.tenantId,
        userId: row.userId,
        partnerId: row.partnerId,
        deviceLabel: row.deviceLabel,
        ip: ip ?? row.ip,
        issuedAt: new Date(result.record.issuedAt),
        expiresAt: new Date(result.record.expiresAt),
        lastSeenAt: new Date(now),
      });
    }

    const [u] = await this.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, row.userId));
    return { result, email: u?.email };
  }

  /** Revoke an entire device family (per-device or admin revoke — ACC-02). */
  async revokeFamily(familyId: string, now: number): Promise<void> {
    await this.db
      .update(schema.trustedDevices)
      .set({ revokedAt: new Date(now) })
      .where(eq(schema.trustedDevices.familyId, familyId));
  }

  /** Active device families for a user (ACC-02 list). One entry per family. */
  async listForUser(userId: string, now: number): Promise<DeviceSummary[]> {
    const rows = await this.db
      .select()
      .from(schema.trustedDevices)
      .where(eq(schema.trustedDevices.userId, userId));

    const byFamily = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byFamily.get(r.familyId) ?? [];
      list.push(r);
      byFamily.set(r.familyId, list);
    }

    const out: DeviceSummary[] = [];
    for (const [familyId, frows] of byFamily) {
      // Active = a live head token exists (not rotated, not revoked, not expired).
      const head = frows.find((r) => !r.rotatedTo && !r.revokedAt && r.expiresAt.getTime() > now);
      if (!head) continue;
      const created = Math.min(...frows.map((r) => r.issuedAt.getTime()));
      const lastSeen = Math.max(0, ...frows.map((r) => r.lastSeenAt?.getTime() ?? 0));
      out.push({
        familyId,
        deviceLabel: head.deviceLabel,
        ip: head.ip,
        createdAt: new Date(created).toISOString(),
        lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
      });
    }
    return out.sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));
  }

  /** Owner (tenant + user) of a family, for revoke authorization. */
  async familyScope(familyId: string): Promise<{ tenantId: string; userId: string } | null> {
    const [row] = await this.db
      .select({ tenantId: schema.trustedDevices.tenantId, userId: schema.trustedDevices.userId })
      .from(schema.trustedDevices)
      .where(eq(schema.trustedDevices.familyId, familyId))
      .limit(1);
    return row ?? null;
  }
}

export interface DeviceSummary {
  familyId: string;
  deviceLabel: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}
