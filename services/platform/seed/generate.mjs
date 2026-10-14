// Writes demo.json and dev-load.json. Ids are UUIDv5 of a fixed name, so every run gives the same files
// and the seed script can be re-run safely (TDD Step 1.2). Run: node services/platform/seed/generate.mjs
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAMESPACE = '6f1f5a52-3c1f-4d6e-9b73-2f4c0e8f9a11';

function uuid5(name) {
  const bytes = createHash('sha1')
    .update(Buffer.concat([Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex'), Buffer.from(name)]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// A folder is a name or [name, [children]].
function folders(parent, items) {
  return items.map((item) => {
    const [name, children = []] = Array.isArray(item) ? item : [item];
    const path = `${parent}/${name}`;
    return { id: uuid5(`folder:${path}`), name, folders: folders(path, children) };
  });
}

function team(name, members, binders) {
  return {
    id: uuid5(`team:${name}`),
    name,
    members,
    binders: binders.map(([binderName, items]) => ({
      id: uuid5(`binder:${name}/${binderName}`),
      name: binderName,
      folders: folders(`${name}/${binderName}`, items),
    })),
  };
}

const priya = { email: 'priya.shah@example.com', name: 'Priya Shah' };
const raj = { email: 'raj.mehta@example.com', name: 'Raj Mehta' };
const sam = { email: 'sam.ito@example.com', name: 'Sam Ito' };

// The teams, binders and folders of the UI mockup (docs/design/ui/Main.dc.html).
const demo = {
  users: [priya, raj, sam],
  teams: [
    team('Cardio', [priya.email, raj.email], [
      ['CARDIO-301 Regulatory', ['IRB approvals', ['Protocol amendments', ['2026']]]],
      ['CARDIO-301 Site files', ['Delegation logs', 'Training records']],
    ]),
    team('Oncology', [priya.email], [
      ['ONC-118 Regulatory', ['Ethics committee', 'Investigator CVs']],
      ['ONC-118 Pharmacy', ['Temperature logs']],
    ]),
    team('Neuro', [sam.email], [['NEU-207 Regulatory', ['Site approvals']]]),
  ],
};

// 50 teams with nested folders for one user, to test the browse target at its limit.
const loadUser = { email: 'load.user@example.com', name: 'Load User' };
const level = (prefix) => ['A', 'B', 'C'].map((n) => [`${prefix}${n}`, [[`${prefix}${n}-1`, [`${prefix}${n}-1-x`, `${prefix}${n}-1-y`]], `${prefix}${n}-2`]]);
const load = {
  users: [loadUser],
  teams: Array.from({ length: 50 }, (_, i) => {
    const name = `Load Team ${String(i + 1).padStart(2, '0')}`;
    return team(name, [loadUser.email], [
      ['Regulatory', level('R')],
      ['Operations', level('O')],
    ]);
  }),
};

const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(dir, 'demo.json'), JSON.stringify(demo, null, 2) + '\n');
writeFileSync(join(dir, 'dev-load.json'), JSON.stringify(load) + '\n');
console.log('wrote demo.json and dev-load.json');
