// Samples pg_stat_activity of the DocBeam database every 250 ms for a number of minutes (D-M5-16), as a one-off ECS
// task. It prints one JSON line (starting "SAMPLE ") for a sample that shows a backend waiting on something other than
// the client, an ungranted lock, or 3 or more active backends, and one line every 5 seconds otherwise.
// Run it with scripts/m5-pg-sample.sh <minutes>, which passes this file to the task.
import pg from 'pg';
import { withDatabaseUrl } from '@docbeam/shared';

const minutes = Number(process.env.SAMPLE_MINUTES ?? 10);
const pool = new pg.Pool({ connectionString: withDatabaseUrl(process.env).DATABASE_URL, max: 1 });
const end = Date.now() + minutes * 60_000;
let lastBeat = 0;
let samples = 0;
let interesting = 0;

while (Date.now() < end) {
  const rows = (
    await pool.query(`
      SELECT wait_event_type AS type, wait_event AS event, state, count(*)::int AS n,
             coalesce(max(extract(epoch FROM now() - query_start)) * 1000, 0)::int AS longest_ms
        FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()
       GROUP BY 1, 2, 3`)
  ).rows;
  const ungranted = (await pool.query('SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted')).rows[0].n;
  samples += 1;
  const active = rows.filter((r) => r.state === 'active').reduce((s, r) => s + r.n, 0);
  const waiting = rows.filter((r) => r.type && r.type !== 'Client' && r.type !== 'Activity');
  const flagged = waiting.length > 0 || ungranted > 0 || active >= 3;
  if (flagged) interesting += 1;
  if (flagged || Date.now() - lastBeat > 5000) {
    lastBeat = Date.now();
    console.log('SAMPLE ' + JSON.stringify({ t: new Date().toISOString(), active, ungranted, waiting, backends: rows.reduce((s, r) => s + r.n, 0) }));
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.log('SAMPLE_DONE ' + JSON.stringify({ samples, interesting }));
await pool.end();
