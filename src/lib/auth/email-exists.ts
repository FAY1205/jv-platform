import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

// PRN-08 documented exemption: signup treats email as globally unique (Supabase Auth enforces
// one auth user per email project-wide), so this existence check is DELIBERATELY cross-tenant and
// cross-role. It returns only a boolean — no row data crosses a tenant boundary. Do not widen it
// to select more columns.
export async function emailExistsGlobally(db: PostgresJsDatabase<typeof schema>, email: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
  return Boolean(row);
}
