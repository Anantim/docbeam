import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compose, env } from './helpers.js';

const url = (user: string, password: string) => `postgres://${user}:${password}@localhost:5432/docbeam_db`;
let admin: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('postgres', env.POSTGRES_PASSWORD ?? '') });
  app = new pg.Client({ connectionString: url('docbeam_app', env.DOCBEAM_APP_PASSWORD ?? '') });
  await Promise.all([admin.connect(), app.connect()]);
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function insertJobWithTask(client: pg.Client): Promise<{ jobId: string; fileId: string; binderId: string }> {
  const jobId = randomUUID();
  const fileId = randomUUID();
  const binderId = randomUUID();
  const user = randomUUID();
  await client.query(
    `INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key) VALUES ($1,$2,'Priya Shah',1,$3)`,
    [jobId, user, randomUUID()],
  );
  await client.query(
    `INSERT INTO files (id, owner_user_id, job_id, original_name, size_bytes, content_type, checksum_sha256, s3_key)
     VALUES ($1,$2,$3,'a.pdf',10,'application/pdf',repeat('a',64),'staging/x')`,
    [fileId, user, jobId],
  );
  await client.query(
    `INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, destination_path) VALUES ($1,$2,$3,$4,$5,'Cardio / CARDIO-301 Regulatory')`,
    [randomUUID(), jobId, fileId, randomUUID(), binderId],
  );
  return { jobId, fileId, binderId };
}

describe('DocBeam DB (Step 1.5, D-G8)', () => {
  it('has the six tables of the TDD, owned by the owner role', async () => {
    const { rows } = await admin.query(
      `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations' ORDER BY 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(['audit_events', 'files', 'jobs', 'tasks', 'ws_connections']);
    expect(new Set(rows.map((r) => r.tableowner))).toEqual(new Set(['docbeam_owner']));
  });

  it('lets the app role INSERT and SELECT on audit_events, and nothing else', async () => {
    const { jobId } = await insertJobWithTask(app);
    await app.query(`INSERT INTO audit_events (action, job_id, detail) VALUES ('job.submitted', $1, '{"actorName":"Priya Shah"}')`, [jobId]);
    const read = await app.query('SELECT action FROM audit_events WHERE job_id = $1', [jobId]);
    expect(read.rows).toEqual([{ action: 'job.submitted' }]);
    await expect(app.query(`UPDATE audit_events SET action = 'x' WHERE job_id = $1`, [jobId])).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM audit_events WHERE job_id = $1', [jobId])).rejects.toThrow(/permission denied/);
    await expect(app.query('TRUNCATE audit_events')).rejects.toThrow(/permission denied/);
  });

  it('stops the same file going to the same destination twice, with and without a folder', async () => {
    const { jobId, fileId, binderId } = await insertJobWithTask(app);
    const again = (folder: string | null) =>
      app.query(
        `INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, folder_id, destination_path) VALUES ($1,$2,$3,$4,$5,$6,'x')`,
        [randomUUID(), jobId, fileId, randomUUID(), binderId, folder],
      );
    await expect(again(null)).rejects.toThrow(/uq_tasks_dest_root/);
    const folder = randomUUID();
    await again(folder);
    await expect(again(folder)).rejects.toThrow(/uq_tasks_dest/);
  });

  it('refuses a repeated idempotency key for one user and a bad status', async () => {
    const user = randomUUID();
    const key = randomUUID();
    const insert = () =>
      app.query(`INSERT INTO jobs (id, submitted_by_user_id, submitted_by_name, task_count, idempotency_key) VALUES ($1,$2,'A',1,$3)`, [
        randomUUID(),
        user,
        key,
      ]);
    await insert();
    await expect(insert()).rejects.toThrow(/uq_jobs_idem/);
    const { jobId, fileId } = await insertJobWithTask(app);
    await expect(
      app.query(`INSERT INTO tasks (id, job_id, file_id, team_id, binder_id, status, destination_path) VALUES ($1,$2,$3,$4,$5,'done','x')`, [
        randomUUID(), jobId, fileId, randomUUID(), randomUUID(),
      ]),
    ).rejects.toThrow(/tasks_status_check/);
  });

  it('runs its migrations again over a database that already holds data, and keeps the data', async () => {
    const { jobId } = await insertJobWithTask(app);
    const before = await admin.query('SELECT count(*) FROM jobs');
    compose('run', '--rm', '--no-deps', '--entrypoint', 'node', 'docbeam-api', 'dist/migrate.js');
    const after = await admin.query('SELECT count(*) FROM jobs');
    expect(after.rows[0].count).toBe(before.rows[0].count);
    const kept = await app.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    expect(kept.rows).toHaveLength(1);
    const grants = await admin.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'docbeam_app' AND table_name = 'audit_events' ORDER BY 1`,
    );
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });
});
