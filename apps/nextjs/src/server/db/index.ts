import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "~/env";
import * as schema from "./schema";

/**
 * Next dev/HMR re-evaluates modules, which would otherwise open a new pool on
 * every reload until Postgres refuses connections. Cache the client on
 * `globalThis` in development only.
 *
 * NOTE: this caches a *stateless connection pool*, never interview state.
 * All interview state lives in the database — see the concurrency notes in
 * `src/server/interview/service.ts`.
 */
const globalForDb = globalThis as unknown as {
  __skillPassportSql?: ReturnType<typeof postgres>;
};

/**
 * Pool size PER APP INSTANCE.
 *
 * This is not a cap on concurrent interviews. A connection is held only for
 * the milliseconds a query runs — the slow parts of a turn (Sarvam STT,
 * OpenAI, Sarvam TTS) all happen outside any connection, so a small pool
 * serves far more candidates than its size suggests.
 *
 * Raise it only if you actually observe queries queueing. The ceiling is the
 * server's max_connections divided by the number of running instances.
 */
const sql =
  globalForDb.__skillPassportSql ??
  postgres(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    // Hand idle connections back so several instances can share the server.
    idle_timeout: 30,
    connect_timeout: 15,
  });

if (env.NODE_ENV !== "production") globalForDb.__skillPassportSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
