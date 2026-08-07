import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { SignupCodeRecord } from "./signup-code";

// SCP-06: persistence for signup invitation codes. Only the hash is stored; the
// plaintext exists only where the owner copied it. Server-managed (service role).

type DB = PostgresJsDatabase<typeof schema>;

export interface StoredSignupCode {
  id: string;
  codeHash: string;
  expiresAt: number;
  usedAt?: number;
}

export interface ActiveCodeSummary {
  id: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

export class SignupCodeStore {
  constructor(private db: DB) {}

  /** Persist a freshly-minted code. Returns its id (for showing the owner nothing
   *  sensitive — the id is not the code). Throws on the astronomically-rare hash
   *  collision (unique index); the caller regenerates. */
  async persist(rec: SignupCodeRecord, createdBy: string): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(schema.signupCodes)
      .values({ codeHash: rec.codeHash, expiresAt: new Date(rec.expiresAt), createdBy })
      .returning({ id: schema.signupCodes.id });
    return { id: row.id };
  }

  async findByHash(codeHash: string): Promise<StoredSignupCode | null> {
    const [row] = await this.db.select().from(schema.signupCodes).where(eq(schema.signupCodes.codeHash, codeHash));
    if (!row) return null;
    return {
      id: row.id,
      codeHash: row.codeHash,
      expiresAt: new Date(row.expiresAt).getTime(),
      usedAt: row.usedAt ? new Date(row.usedAt).getTime() : undefined,
    };
  }

  /** Unused, unexpired codes for the owner surface (never the hash/plaintext). */
  async listActive(now: number): Promise<ActiveCodeSummary[]> {
    const rows = await this.db
      .select({
        id: schema.signupCodes.id,
        createdBy: schema.signupCodes.createdBy,
        createdAt: schema.signupCodes.createdAt,
        expiresAt: schema.signupCodes.expiresAt,
      })
      .from(schema.signupCodes)
      .where(and(isNull(schema.signupCodes.usedAt), gt(schema.signupCodes.expiresAt, new Date(now))))
      .orderBy(desc(schema.signupCodes.createdAt));
    return rows.map((r) => ({
      id: r.id,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      expiresAt: new Date(r.expiresAt).toISOString(),
    }));
  }

  /** Revoke an unused code (owner surface): mark it used so it can never redeem.
   *  No-op if already used/gone. */
  async revoke(id: string): Promise<void> {
    await this.db
      .update(schema.signupCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.signupCodes.id, id), isNull(schema.signupCodes.usedAt)));
  }
}
