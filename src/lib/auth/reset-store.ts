import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { ResetTokenRecord } from "./reset-token";

// AUT-06: persistence for password-reset tokens. Only the hash is stored (0005
// migration); the secret exists only in the email. Server-managed (service role).

type DB = PostgresJsDatabase<typeof schema>;

export type StoredResetToken = ResetTokenRecord & { id: string };

export class ResetStore {
  constructor(private db: DB) {}

  async persist(rec: ResetTokenRecord): Promise<void> {
    await this.db.insert(schema.resetTokens).values({
      userId: rec.userId,
      tokenHash: rec.tokenHash,
      expiresAt: new Date(rec.expiresAt),
    });
  }

  async findByHash(tokenHash: string): Promise<StoredResetToken | null> {
    const [row] = await this.db
      .select()
      .from(schema.resetTokens)
      .where(eq(schema.resetTokens.tokenHash, tokenHash));
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: new Date(row.expiresAt).getTime(),
      usedAt: row.usedAt ? new Date(row.usedAt).getTime() : undefined,
    };
  }

  async markUsed(id: string, usedAt: number): Promise<void> {
    await this.db
      .update(schema.resetTokens)
      .set({ usedAt: new Date(usedAt) })
      .where(eq(schema.resetTokens.id, id));
  }
}
