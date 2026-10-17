import { describe, expect, it } from 'vitest';
import { DEV_MAX_CONCURRENCY, devWorstCaseConnections, LAMBDA_POOL, SERVICE_POOL } from './db.js';

// The dev instance has max_connections = 100 (infra/envs/dev/main.tf). The budget stays under 80% of it (D-M0-6).
const DEV_MAX_CONNECTIONS = 100;

describe('connection budget (D-M0-6)', () => {
  it('opens at most one connection per Lambda copy, with a short idle timeout', () => {
    expect(LAMBDA_POOL.max).toBe(1);
    expect(LAMBDA_POOL.idleTimeoutMillis).toBeLessThanOrEqual(5_000);
  });

  it('keeps ECS service pools small', () => {
    expect(SERVICE_POOL.max).toBeLessThanOrEqual(3);
  });

  it('uses the design trigger caps for Delivery and Upload Events', () => {
    expect(DEV_MAX_CONCURRENCY.delivery).toBe(50);
    expect(DEV_MAX_CONCURRENCY.uploadEvents).toBe(10);
  });

  it('keeps the dev worst case under 80% of max_connections', () => {
    // 68 Lambda copies (50 + 10 + 2 + 2 + 1 + 3) + 6 ECS connections (3 services x 2)
    // + 2 one-off tasks + 3 reserved by RDS = 79.
    const worst = devWorstCaseConnections();
    expect(worst).toBe(79);
    expect(worst).toBeLessThanOrEqual(DEV_MAX_CONNECTIONS * 0.8);
  });

  // After a failover the old connections are dead but silent (M5 check 5.8): a query on one must time out, so that
  // the pool throws the connection away instead of staying blocked for ever.
  it('gives every pool a query timeout and TCP keep-alive', () => {
    for (const pool of [LAMBDA_POOL, SERVICE_POOL]) {
      expect(pool.query_timeout).toBeGreaterThan(0);
      expect(pool.query_timeout).toBeLessThanOrEqual(30_000);
      expect(pool.keepAlive).toBe(true);
    }
  });
});
