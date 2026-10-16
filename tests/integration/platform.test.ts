import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';
import { createDb } from '../../services/platform/src/db.js';
import { applySeed, type SeedFile } from '../../services/platform/src/seed.js';
import { AUTH_URL, PLATFORM_URL, call, env, registerAndLogin, serviceToken, uniqueEmail } from './helpers.js';

const demo: SeedFile = JSON.parse(readFileSync(new URL('../../services/platform/seed/demo.json', import.meta.url), 'utf8'));
const team = (name: string) => demo.teams.find((t) => t.name === name)!;
const binder = (teamName: string, name: string) => team(teamName).binders.find((b) => b.name === name)!;

async function login(email: string): Promise<{ id: string; token: string }> {
  const res = await call(AUTH_URL, '/auth/login', { json: { email, password: env.SEED_USER_PASSWORD } });
  if (res.status !== 200) throw new Error(`seed user ${email} cannot sign in (${res.status})`);
  const lookup = await call(AUTH_URL, `/internal/users?email=${encodeURIComponent(email)}`, {
    token: await serviceToken('seed-script', 'users:read'),
  });
  return { id: lookup.body.id, token: res.body.accessToken };
}

let priya: { id: string; token: string };
let raj: { id: string; token: string };
let sam: { id: string; token: string };

beforeAll(async () => {
  priya = await login('priya.shah@example.com');
  raj = await login('raj.mehta@example.com');
  sam = await login('sam.ito@example.com');
});

describe('browse: only your own teams (flow 1, "Who can see what")', () => {
  it('lists only the caller\'s teams', async () => {
    const p = await call(PLATFORM_URL, '/teams', { token: priya.token });
    expect(p.body.map((t: { name: string }) => t.name)).toEqual(['Cardio', 'Oncology']);
    const r = await call(PLATFORM_URL, '/teams', { token: raj.token });
    expect(r.body.map((t: { name: string }) => t.name)).toEqual(['Cardio']);
    const s = await call(PLATFORM_URL, '/teams', { token: sam.token });
    expect(s.body.map((t: { name: string }) => t.name)).toEqual(['Neuro']);
  });

  it('a user in no team gets an empty list', async () => {
    const nobody = await registerAndLogin();
    const res = await call(PLATFORM_URL, '/teams', { token: nobody.token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('lists a member\'s binders and answers 404 for another team', async () => {
    const own = await call(PLATFORM_URL, `/teams/${team('Cardio').id}/binders`, { token: priya.token });
    expect(own.status).toBe(200);
    expect(own.body.map((b: { name: string }) => b.name)).toEqual(['CARDIO-301 Regulatory', 'CARDIO-301 Site files']);
    const other = await call(PLATFORM_URL, `/teams/${team('Neuro').id}/binders`, { token: priya.token });
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('NOT_FOUND');
  });

  it('reads one level of a binder, and 404 for another team\'s binder', async () => {
    const top = await call(PLATFORM_URL, `/binders/${binder('Cardio', 'CARDIO-301 Regulatory').id}/contents`, { token: priya.token });
    expect(top.status).toBe(200);
    expect(top.body.folders.map((f: { name: string }) => f.name)).toEqual(['IRB approvals', 'Protocol amendments']);
    // Delivered documents may sit here (M2: the job tests deliver to the top level), so the level is
    // checked for its shape, not for being empty.
    expect(Array.isArray(top.body.documents)).toBe(true);
    for (const d of top.body.documents) expect(Object.keys(d).sort()).toEqual(['contentType', 'createdAt', 'id', 'name', 'sizeBytes']);

    const neuro = binder('Neuro', 'NEU-207 Regulatory').id;
    const denied = await call(PLATFORM_URL, `/binders/${neuro}/contents`, { token: priya.token });
    expect(denied.status).toBe(404);
    const sameAsMissing = await call(PLATFORM_URL, `/binders/${randomUUID()}/contents`, { token: priya.token });
    expect(denied.body).toEqual(sameAsMissing.body);
  });

  it('reads one folder level at a time, and 404 for another team\'s folder', async () => {
    const amendments = binder('Cardio', 'CARDIO-301 Regulatory').folders.find((f) => f.name === 'Protocol amendments')!;
    const inside = await call(PLATFORM_URL, `/folders/${amendments.id}/contents`, { token: raj.token });
    expect(inside.status).toBe(200);
    expect(inside.body.folders.map((f: { name: string }) => f.name)).toEqual(['2026']);

    const oncFolder = binder('Oncology', 'ONC-118 Regulatory').folders[0]!;
    expect((await call(PLATFORM_URL, `/folders/${oncFolder.id}/contents`, { token: raj.token })).status).toBe(404);
    expect((await call(PLATFORM_URL, `/folders/${oncFolder.id}/contents`, { token: priya.token })).status).toBe(200);
  });

  it('answers 404 for an id that is not a UUID', async () => {
    expect((await call(PLATFORM_URL, '/binders/not-a-uuid/contents', { token: priya.token })).status).toBe(404);
    expect((await call(PLATFORM_URL, '/teams/1/binders', { token: priya.token })).status).toBe(404);
  });

  it('answers 401 with no token and 401 with a service token on a user route', async () => {
    expect((await call(PLATFORM_URL, '/teams')).status).toBe(401);
    const service = await serviceToken('docbeam-api', 'memberships:read');
    expect((await call(PLATFORM_URL, '/teams', { token: service })).status).toBe(401);
  });

  it('browses a user in 50 teams in under a second (dev load seed)', async () => {
    const load = await login('load.user@example.com');
    const started = performance.now();
    const teams = await call(PLATFORM_URL, '/teams', { token: load.token });
    expect(teams.body).toHaveLength(50);
    const binders = await call(PLATFORM_URL, `/teams/${teams.body[0].id}/binders`, { token: load.token });
    const contents = await call(PLATFORM_URL, `/binders/${binders.body[0].id}/contents`, { token: load.token });
    expect(contents.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('service routes (ADR-013)', () => {
  it('checks a batch of destinations and returns team and path', async () => {
    const token = await serviceToken('docbeam-api', 'memberships:read');
    const regulatory = binder('Cardio', 'CARDIO-301 Regulatory');
    const amendments = regulatory.folders.find((f) => f.name === 'Protocol amendments')!;
    const res = await call(PLATFORM_URL, '/destinations/check', {
      token,
      json: {
        userId: priya.id,
        destinations: [
          { binderId: regulatory.id },
          { binderId: regulatory.id, folderId: amendments.folders[0]!.id },
          { binderId: binder('Oncology', 'ONC-118 Pharmacy').id },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.destinations).toEqual([
      { binderId: regulatory.id, folderId: null, teamId: team('Cardio').id, teamName: 'Cardio', path: 'Cardio / CARDIO-301 Regulatory' },
      {
        binderId: regulatory.id,
        folderId: amendments.folders[0]!.id,
        teamId: team('Cardio').id,
        teamName: 'Cardio',
        path: 'Cardio / CARDIO-301 Regulatory / Protocol amendments / 2026',
      },
      { binderId: binder('Oncology', 'ONC-118 Pharmacy').id, folderId: null, teamId: team('Oncology').id, teamName: 'Oncology', path: 'Oncology / ONC-118 Pharmacy' },
    ]);
  });

  it('answers 422 listing every bad destination, the same for missing and for another team', async () => {
    const token = await serviceToken('docbeam-api', 'memberships:read');
    const good = binder('Cardio', 'CARDIO-301 Regulatory');
    const neuro = binder('Neuro', 'NEU-207 Regulatory');
    const missing = randomUUID();
    const wrongFolder = binder('Cardio', 'CARDIO-301 Site files').folders[0]!;
    const res = await call(PLATFORM_URL, '/destinations/check', {
      token,
      json: {
        userId: priya.id,
        destinations: [
          { binderId: good.id },
          { binderId: neuro.id },
          { binderId: missing },
          { binderId: good.id, folderId: wrongFolder.id },
          { binderId: 'not-a-uuid' },
        ],
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DESTINATION_NOT_FOUND');
    expect(res.body.notFound).toEqual([
      { binderId: neuro.id, folderId: null },
      { binderId: missing, folderId: null },
      { binderId: good.id, folderId: wrongFolder.id },
      { binderId: 'not-a-uuid', folderId: null },
    ]);
  });

  it('lists the teams of a user', async () => {
    const token = await serviceToken('docbeam-api', 'memberships:read');
    const res = await call(PLATFORM_URL, `/users/${priya.id}/teams`, { token });
    expect(res.status).toBe(200);
    expect([...res.body.teamIds].sort()).toEqual([team('Cardio').id, team('Oncology').id].sort());
  });

  it('refuses a user token, no token, and a service token without the scope', async () => {
    const path = `/users/${priya.id}/teams`;
    expect((await call(PLATFORM_URL, path, { token: priya.token })).status).toBe(401);
    expect((await call(PLATFORM_URL, path)).status).toBe(401);
    const ingestOnly = await serviceToken('delivery-worker', 'documents:ingest');
    expect((await call(PLATFORM_URL, path, { token: ingestOnly })).status).toBe(403);
    const body = { userId: priya.id, destinations: [{ binderId: team('Cardio').binders[0]!.id }] };
    expect((await call(PLATFORM_URL, '/destinations/check', { token: priya.token, json: body })).status).toBe(401);
  });
});

describe('seed script (Step 1.2)', () => {
  const { db, pool } = createDb(`postgres://platform_app:${env.PLATFORM_APP_PASSWORD}@localhost:5432/platform_db`);

  it('two runs in a row change nothing, a removed member is pruned, an unknown email is skipped with a warning', async () => {
    const member = await registerAndLogin(uniqueEmail('seedmember'));
    const stranger = uniqueEmail('nobody-has-this');
    const file: SeedFile = {
      users: [],
      teams: [
        {
          id: randomUUID(),
          name: 'Seed test team',
          members: [member.email, stranger],
          binders: [{ id: randomUUID(), name: 'Seed test binder', folders: [{ id: randomUUID(), name: 'Sub', folders: [] }] }],
        },
      ],
    };
    const ids = new Map([[member.email.toLowerCase(), member.id]]);

    const first = await applySeed(db, file, ids);
    expect(first).toMatchObject({ teamsChanged: 1, bindersChanged: 1, foldersChanged: 1, membersAdded: 1, membersRemoved: 0 });
    expect(first.skippedEmails).toEqual([stranger]);

    const second = await applySeed(db, file, ids);
    expect(second).toMatchObject({ teamsChanged: 0, bindersChanged: 0, foldersChanged: 0, membersAdded: 0, membersRemoved: 0 });

    const visible = await call(PLATFORM_URL, '/teams', { token: member.token });
    expect(visible.body.map((t: { name: string }) => t.name)).toEqual(['Seed test team']);

    file.teams[0]!.members = [stranger];
    const pruned = await applySeed(db, file, ids);
    expect(pruned.membersRemoved).toBe(1);
    const after = await call(PLATFORM_URL, '/teams', { token: member.token });
    expect(after.body).toEqual([]);
  });

  it('afterAll closes the pool', async () => {
    await pool.end();
  });
});
