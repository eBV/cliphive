export * from "./schema";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Create a Drizzle database client.
 * Call this once per application and pass the instance around.
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 10, prepare: false });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
