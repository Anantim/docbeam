// Database connection limits. They keep the total under the instance's max_connections (D-M0-6).
// Nothing here knows whether an RDS Proxy sits in front of the database: only the host in config differs.

/** Options for a `pg` Pool, as a plain object so this package needs no database library. */
export interface PoolLimits {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  allowExitOnIdle: boolean;
}

/**
 * A Lambda copy handles one message at a time, so it needs one connection. The short idle timeout
 * returns the connection soon after the work is done, because a warm copy that sleeps would hold it for nothing.
 */
export const LAMBDA_POOL: PoolLimits = {
  max: 1,
  idleTimeoutMillis: 1_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: true,
};

/** ECS services keep a small pool each (ADR-011). */
export const SERVICE_POOL: PoolLimits = {
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: false,
};

/** The Lambda that may run at once, per function, in dev. Terraform sets the same numbers as trigger or reserved concurrency. */
export const DEV_MAX_CONCURRENCY = {
  delivery: 50,
  uploadEvents: 10,
  fanout: 2,
  dlq: 2,
  sweeper: 1,
  ws: 3,
} as const;

/** ECS tasks in dev: one task per service, three services. */
export const DEV_SERVICE_TASKS = 3;
/** One-off tasks (migrate, seed, bootstrap) that may run at once, one connection each. */
export const DEV_ONE_OFF_TASKS = 2;
/** Connections RDS keeps for itself and for superuser_reserved_connections. */
export const DB_RESERVED_CONNECTIONS = 3;

/** The most connections the dev setup can open at the same moment. */
export function devWorstCaseConnections(): number {
  const lambdas = Object.values(DEV_MAX_CONCURRENCY).reduce((sum, n) => sum + n, 0) * LAMBDA_POOL.max;
  const services = DEV_SERVICE_TASKS * SERVICE_POOL.max;
  return lambdas + services + DEV_ONE_OFF_TASKS + DB_RESERVED_CONNECTIONS;
}
