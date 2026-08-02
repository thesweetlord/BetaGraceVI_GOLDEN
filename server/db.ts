import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/db-schema";

const databaseUrl = process.env.DATABASE_URL?.trim();

let pool: any = null;
let db: any = null;

if (databaseUrl) {
  pool = new Pool({ connectionString: databaseUrl });

  // Add error handling to prevent unhandled promise rejections
  pool.on('error', (err: Error) => {
    console.error('[POOL] Unexpected error on idle client:', err);
    // Don't crash the process - allow graceful degradation
  });

  db = drizzle(pool, { schema });
}

export { pool, db };
