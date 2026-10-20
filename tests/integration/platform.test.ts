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
    expect(p.body.items.map((t: { name: string }) => t.name)).toEqual(['Cardio', 'Oncology']);
    const r = await call(PLATFORM_URL, '/teams', { token: raj.token });
    expect(r.body.items.map((t: { name: string }) => t.name)).toEqual(['Cardio']);
    const s = await call(PLATFORM_URL, '/teams', { token: sam.token });
    expect(s.body.items.map((t: { name: string }) => t.name)).toEqual(['Neuro']);
  });

  it('GET /teams/members lists the people who share a team with the caller, once each, by name (D-F1-21)', async () => {
    const names = async (token: string) => ((await call(PLATFORM_URL, '/teams/members', { token })).body.items as Array<{ name: string }>).map((m) => m.name);
    // Cardio: Priya, Raj, Anantim. Oncology: Priya and others. Neuro: Sam and Anantim.
    expect(await names(raj.token)).toEqual(['Anantim Patil', 'Priya Shah', 'Raj Mehta']); // Raj is in Cardio only
    const samSees = await names(sam.token); // Neuro: Sam and Anantim; not Priya or Raj
    expect(samSees).toContain('Sam Ito');
    expect(samSees).not.toContain('Priya Shah');
    expect(samSees).not.toContain('Raj Mehta');
    const priyaList = (await call(PLATFORM_URL, '/teams/members', { token: priya.token })).body.items as Array<{ userId: string; name: string }>;
    expect(new Set(priyaList.map((m) => m.userId)).size).toBe(priyaList.length); // once each, though some share two teams
    expect(priyaList.map((m) => m.name)).not.toContain('Sam Ito'); // a person in none of her teams is not revealed
    expect(priyaList.every((m) => m.userId.length === 36)).toBe(true);
    expect(priyaList.map((m) => m.name)).not.toContain('Sam Ito');
    const nobody = await registerAndLogin();
    expect((await call(PLATFORM_URL, '/teams/members', { token: nobody.token })).body).toEqual({ items: [] });
    expect((await call(PLATFORM_URL, '/teams/members')).status).toBe(401);
  });

  it('a user in no team gets an empty list', async () => {
    const nobody = await registerAndLogin();
    const res = await call(PLATFORM_URL, '/teams', { token: nobody.token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it('lists a member\'s binders and answers 404 for another team', async () => {
    const own = await call(PLATFORM_URL, `/teams/${team('Cardio').id}/binders`, { token: priya.token });
    expect(own.status).toBe(200);
    expect(own.body.items.map((b: { name: string }) => b.name)).toEqual(['CARDIO-301 Regulatory', 'CARDIO-301 Site files']);
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
    const teams = await call(PLATFORM_URL, '/teams?limit=100', { token: load.token });
    expect(teams.body.items).toHaveLength(50);
    const binders = await call(PLATFORM_URL, `/teams/${teams.body.items[0].id}/binders`, { token: load.token });
    const contents = await call(PLATFORM_URL, `/binders/${binders.body.items[0].id}/contents`, { token: load.token });
    expect(contents.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('browse pages (F1 part B, D-F1-6)', () => {
  type Item = { id: string; name: string };
  const walk = async (path: string, token: string, limit: number, key: (b: any) => Item[]): Promise<{ pages: Item[][]; cursors: Array<string | null> }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const pages: Item[][] = [];
    const cursors: Array<string | null> = [];
    let cursor: string | null = null;
    do {
      const res: { status: number; body: any } = await call(PLATFORM_URL, `${path}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token }); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(res.status).toBe(200);
      pages.push(key(res.body));
      cursor = res.body.nextCursor;
      cursors.push(cursor);
    } while (cursor !== null && pages.length < 50);
    return { pages, cursors };
  };
  const sorted = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b, 'en', { numeric: false }));

  it('pages the 50 teams of the load user by name then id: 20, 20, 10, then null', async () => {
    const load = await login('load.user@example.com');
    const { pages, cursors } = await walk('/teams', load.token, 20, (b) => b.items);
    expect(pages.map((p) => p.length)).toEqual([20, 20, 10]);
    expect(cursors).toEqual([expect.any(String), expect.any(String), null]);
    const names = pages.flat().map((t) => t.name);
    expect(new Set(names).size).toBe(50); // no repeat, no gap
    expect(names).toEqual(sorted(names));
    expect(names[0]).toBe('Load Team 01');
    expect(names[49]).toBe('Load Team 50');
  });

  it('teams come 50 at a time by default, binders and folders 20; the largest limit is 100; a bigger or odd one is a 400', async () => {
    const load = await login('load.user@example.com');
    const teams = await call(PLATFORM_URL, '/teams', { token: load.token });
    expect(teams.body.items).toHaveLength(50); // all 50 teams of the load user in one call
    expect(teams.body.nextCursor).toBeNull();
    const firstTen = await call(PLATFORM_URL, '/teams?limit=10', { token: load.token });
    expect(firstTen.body.items).toHaveLength(10);
    expect(firstTen.body.nextCursor).toEqual(expect.any(String));
    const paging = await login('paging.user@example.com');
    const team = (await call(PLATFORM_URL, '/teams', { token: paging.token })).body.items[0] as { id: string };
    const binder = (await call(PLATFORM_URL, `/teams/${team.id}/binders`, { token: paging.token })).body.items[0] as { id: string };
    const top = (await call(PLATFORM_URL, `/binders/${binder.id}/contents`, { token: paging.token })).body.folders as Array<{ id: string }>;
    const archive = await call(PLATFORM_URL, `/folders/${top[0]!.id}/contents`, { token: paging.token });
    expect(archive.body.folders).toHaveLength(20); // folders stay at 20 a page
    expect(archive.body.nextCursor).toEqual(expect.any(String));
    expect((await call(PLATFORM_URL, '/teams?limit=100', { token: load.token })).body.nextCursor).toBeNull();
    for (const bad of ['0', '101', 'abc', '-3']) {
      const res = await call(PLATFORM_URL, `/teams?limit=${bad}`, { token: load.token });
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('a limit that fits exactly gives a null cursor on the last page, not an empty extra page', async () => {
    const load = await login('load.user@example.com');
    const { pages } = await walk('/teams', load.token, 25, (b) => b.items);
    expect(pages.map((p) => p.length)).toEqual([25, 25]);
  });

  it('a bad cursor is a 400, on every route', async () => {
    const load = await login('load.user@example.com');
    const team0 = (await call(PLATFORM_URL, '/teams?limit=1', { token: load.token })).body.items[0] as Item;
    const binder0 = (await call(PLATFORM_URL, `/teams/${team0.id}/binders`, { token: load.token })).body.items[0] as Item;
    for (const path of ['/teams', `/teams/${team0.id}/binders`, `/binders/${binder0.id}/contents`]) {
      for (const cursor of ['garbage', Buffer.from('[1,2]').toString('base64url'), Buffer.from(JSON.stringify([0, 'x', 'not-a-uuid'])).toString('base64url')]) {
        const res = await call(PLATFORM_URL, `${path}?cursor=${cursor}`, { token: load.token });
        expect(res.status, `${path} ${cursor}`).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    }
  });

  it('pages a folder of 60 children, 20 at a time, and carries the same access rule on every page', async () => {
    const paging = await login('paging.user@example.com');
    const teams = (await call(PLATFORM_URL, '/teams', { token: paging.token })).body.items as Item[];
    expect(teams.map((t) => t.name)).toEqual(['Paging Team']);
    const binders = (await call(PLATFORM_URL, `/teams/${teams[0]!.id}/binders`, { token: paging.token })).body.items as Item[];
    const top = (await call(PLATFORM_URL, `/binders/${binders[0]!.id}/contents`, { token: paging.token })).body.folders as Item[];
    expect(top.map((f) => f.name)).toEqual(['Archive 2026', 'Empty box']);
    const archive = top[0]!;

    const { pages } = await walk(`/folders/${archive.id}/contents`, paging.token, 20, (b) => b.folders);
    expect(pages.map((p) => p.length)).toEqual([20, 20, 20]);
    const names = pages.flat().map((f) => f.name);
    expect(names[0]).toBe('Batch 001');
    expect(names[59]).toBe('Batch 060');
    expect(new Set(names).size).toBe(60);

    // A page deep in the list is still refused to a stranger, and to a person of another team.
    const first = await call(PLATFORM_URL, `/folders/${archive.id}/contents?limit=20`, { token: paging.token });
    const cursor = encodeURIComponent(first.body.nextCursor);
    for (const outsider of [priya, raj, sam]) {
      const res = await call(PLATFORM_URL, `/folders/${archive.id}/contents?limit=20&cursor=${cursor}`, { token: outsider.token });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await call(PLATFORM_URL, `/folders/${archive.id}/contents?limit=20&cursor=${cursor}`)).status).toBe(401);
    // Team and binder pages too.
    expect((await call(PLATFORM_URL, `/teams/${teams[0]!.id}/binders?limit=1`, { token: priya.token })).status).toBe(404);
    // An empty folder is an empty page, not a 404.
    const empty = await call(PLATFORM_URL, `/folders/${top[1]!.id}/contents`, { token: paging.token });
    expect(empty.body).toEqual({ folders: [], documents: [], nextCursor: null });
  });

  it('a cursor taken from one folder does not read another folder\'s rows', async () => {
    const paging = await login('paging.user@example.com');
    const teams = (await call(PLATFORM_URL, '/teams', { token: paging.token })).body.items as Item[];
    const binders = (await call(PLATFORM_URL, `/teams/${teams[0]!.id}/binders`, { token: paging.token })).body.items as Item[];
    const top = (await call(PLATFORM_URL, `/binders/${binders[0]!.id}/contents`, { token: paging.token })).body.folders as Item[];
    const first = await call(PLATFORM_URL, `/folders/${top[0]!.id}/contents?limit=5`, { token: paging.token });
    // The cursor only says "after Batch 005": used on the empty folder it returns nothing, not Archive's rows.
    const other = await call(PLATFORM_URL, `/folders/${top[1]!.id}/contents?cursor=${encodeURIComponent(first.body.nextCursor)}`, { token: paging.token });
    expect(other.body.folders).toEqual([]);
  });
});

describe('browse pages across folders and documents (F1 part B)', () => {
  const { pool } = createDb(`postgres://platform_app:${env.PLATFORM_APP_PASSWORD}@localhost:5432/platform_db`);

  it('lists folders first, then documents, by name then id, and a page can end between them', async () => {
    const member = await registerAndLogin(uniqueEmail('mixpage'));
    const ids = new Map([[member.email.toLowerCase(), member.id]]);
    const { db } = createDb(`postgres://platform_app:${env.PLATFORM_APP_PASSWORD}@localhost:5432/platform_db`);
    const folderNames = ['b-folder', 'a-folder', 'c-folder'];
    const binderId = randomUUID();
    const topId = randomUUID();
    const file: SeedFile = {
      users: [],
      teams: [
        {
          id: randomUUID(),
          name: 'Mixed page team',
          members: [member.email],
          binders: [{ id: binderId, name: 'Mixed', folders: [{ id: topId, name: 'Top', folders: folderNames.map((name) => ({ id: randomUUID(), name, folders: [] })) }] }],
        },
      ],
    };
    await applySeed(db, file, ids);
    for (const name of ['z-doc.pdf', 'm-doc.pdf', 'a-doc.pdf']) {
      await pool.query(
        `INSERT INTO documents (binder_id, folder_id, name, size_bytes, content_type, checksum_sha256, storage_key, uploaded_by_user_id)
         VALUES ($1, $2, $3, 1, 'application/pdf', $4, $5, $6)`,
        [binderId, topId, name, 'a'.repeat(64), `documents/${randomUUID()}`, member.id],
      );
    }
    // Six children, two at a time: folders a, b | c, then documents a | m, z.
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const res: { status: number; body: any } = await call(PLATFORM_URL, `/folders/${topId}/contents?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token: member.token }); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(res.status).toBe(200);
      seen.push(...res.body.folders.map((f: { name: string }) => f.name), ...res.body.documents.map((d: { name: string }) => d.name));
      sizes.push(res.body.folders.length + res.body.documents.length);
      cursor = res.body.nextCursor;
    } while (cursor !== null && sizes.length < 10);
    expect(sizes).toEqual([2, 2, 2]);
    expect(seen).toEqual(['a-folder', 'b-folder', 'c-folder', 'a-doc.pdf', 'm-doc.pdf', 'z-doc.pdf']);
    await pool.end();
  });
});

describe('service routes (ADR-013)', () => {
  it('checks a batch of destinations and returns team and path', async () => {
    const token = await serviceToken('docbeam-api', 'memberships:read');
    const regulatory = binder('Cardio', 'CARDIO-301 Regulatory');
    const amendments = regulatory.folders.find((f) => f.name === 'Protocol amendments')!;
    const irb = regulatory.folders.find((f) => f.name === 'IRB approvals')!;
    const pharmacy = binder('Oncology', 'ONC-118 Pharmacy');
    const res = await call(PLATFORM_URL, '/destinations/check', {
      token,
      json: {
        userId: priya.id,
        destinations: [
          { binderId: regulatory.id, folderId: irb.id },
          { binderId: regulatory.id, folderId: amendments.folders[0]!.id },
          { binderId: pharmacy.id, folderId: pharmacy.folders[0]!.id },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.destinations).toEqual([
      { binderId: regulatory.id, folderId: irb.id, teamId: team('Cardio').id, teamName: 'Cardio', path: 'Cardio / CARDIO-301 Regulatory / IRB approvals' },
      {
        binderId: regulatory.id,
        folderId: amendments.folders[0]!.id,
        teamId: team('Cardio').id,
        teamName: 'Cardio',
        path: 'Cardio / CARDIO-301 Regulatory / Protocol amendments / 2026',
      },
      {
        binderId: pharmacy.id,
        folderId: pharmacy.folders[0]!.id,
        teamId: team('Oncology').id,
        teamName: 'Oncology',
        path: `Oncology / ONC-118 Pharmacy / ${pharmacy.folders[0]!.name}`,
      },
    ]);
  });

  it('answers 422 for a destination with no folder: a binder is not a destination (D-F1-3)', async () => {
    const token = await serviceToken('docbeam-api', 'memberships:read');
    const regulatory = binder('Cardio', 'CARDIO-301 Regulatory');
    const res = await call(PLATFORM_URL, '/destinations/check', {
      token,
      json: { userId: priya.id, destinations: [{ binderId: regulatory.id }, { binderId: regulatory.id, folderId: null }] },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DESTINATION_NOT_FOUND');
    expect(res.body.notFound).toEqual([
      { binderId: regulatory.id, folderId: null },
      { binderId: regulatory.id, folderId: null },
    ]);
  });

  it('answers 422 listing every bad destination, the same for missing and for another team', async () => {
    const token = await serviceToken('docbeam-api', 'memberships:read');
    const good = binder('Cardio', 'CARDIO-301 Regulatory');
    const neuro = binder('Neuro', 'NEU-207 Regulatory');
    const missing = randomUUID();
    const missingFolder = randomUUID();
    const wrongFolder = binder('Cardio', 'CARDIO-301 Site files').folders[0]!;
    const res = await call(PLATFORM_URL, '/destinations/check', {
      token,
      json: {
        userId: priya.id,
        destinations: [
          { binderId: good.id, folderId: good.folders[0]!.id },
          { binderId: neuro.id, folderId: neuro.folders[0]!.id },
          { binderId: missing, folderId: missingFolder },
          { binderId: good.id, folderId: wrongFolder.id },
          { binderId: 'not-a-uuid', folderId: missingFolder },
        ],
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DESTINATION_NOT_FOUND');
    expect(res.body.notFound).toEqual([
      { binderId: neuro.id, folderId: neuro.folders[0]!.id },
      { binderId: missing, folderId: missingFolder },
      { binderId: good.id, folderId: wrongFolder.id },
      { binderId: 'not-a-uuid', folderId: missingFolder },
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
    const body = { userId: priya.id, destinations: [{ binderId: team('Cardio').binders[0]!.id, folderId: team('Cardio').binders[0]!.folders[0]!.id }] };
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
    expect(visible.body.items.map((t: { name: string }) => t.name)).toEqual(['Seed test team']);

    file.teams[0]!.members = [stranger];
    const pruned = await applySeed(db, file, ids);
    expect(pruned.membersRemoved).toBe(1);
    const after = await call(PLATFORM_URL, '/teams', { token: member.token });
    expect(after.body).toEqual({ items: [], nextCursor: null });
  });

  it('afterAll closes the pool', async () => {
    await pool.end();
  });
});
