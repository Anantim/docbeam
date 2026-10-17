import { SERVICE_POOL } from '@docbeam/shared';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

/** `$client` is the pool under Drizzle. The cancel route hands it to the shared code that needs a plain connection. */
export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

/** A small pool: ECS services keep direct connections (ADR-011). The limits are in one place, so the connection budget holds (D-M0-6). */
export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, ...SERVICE_POOL });
  return { db: drizzle(pool, { schema }), pool };
}
