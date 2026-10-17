import { withDatabaseUrl } from '@docbeam/shared';
import pg from 'pg';
import { FAILURE_RATE_SQL, summariseFailureRate, type TaskCountRow } from './failure-rate.js';

// Prints the delivery failure rate as JSON (M5, scripts/m5-failure-rate.sh).
//   node dist/failure-rate-run.js [days] [since-iso-timestamp]
// Runs as a one-off task in the DocBeam API's own network, with the app role (SELECT on tasks).
const days = Number(process.argv[2] ?? '7');
const since = process.argv[3] ?? null;
const url = withDatabaseUrl(process.env).DATABASE_URL;
if (!url || !Number.isInteger(days) || days < 1) {
  console.error('usage: DATABASE_URL=... node dist/failure-rate-run.js [days] [since-iso-timestamp]');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const { rows } = await pool.query<TaskCountRow>(FAILURE_RATE_SQL, [days, since]);
  console.log(JSON.stringify(summariseFailureRate(rows, days)));
} finally {
  await pool.end();
}
