import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

declare global {
  // Prevent multiple client instances during Next.js Hot Module Replacement in development
  // eslint-disable-next-line no-var
  var _db: NeonHttpDatabase<typeof schema> | undefined;
}

function getDatabaseInstance(): NeonHttpDatabase<typeof schema> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Please add it to your .env.local file.",
    );
  }

  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}

export const db: NeonHttpDatabase<typeof schema> =
  globalThis._db ?? getDatabaseInstance();

if (process.env.NODE_ENV !== "production") {
  globalThis._db = db;
}

export type Database = typeof db;
