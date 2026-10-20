import { describe, expect, it } from 'vitest';
import type { Destination } from '../destinations/selection.js';
import type { FileStatus, PageFile } from '../upload/manager.js';
import {
  applyHeld,
  buildJobRequest,
  chosenKeys,
  deliveryCount,
  describeDestination,
  destinationCounts,
  emptyMapping,
  readiness,
  summarise,
  scopeOf,
  tickState,
  toggleDestination,
  type Mapping,
} from './mapping.js';

const file = (id: string, status: FileStatus = 'verified'): PageFile => ({
  id,
  file: new File([new Uint8Array(1)], `${id}.pdf`),
  name: `${id}.pdf`,
  sizeBytes: 1,
  contentType: 'application/pdf',
  status,
  progress: 1,
  partsDone: 0,
  partCount: 0,
  sha256: 'a'.repeat(64),
  serverId: `server-${id}`,
});

const dest = (n: number): Destination => ({ binderId: `b${n}`, folderId: `f${n}`, path: `Team / Binder ${n} / Folder` });
const key = (d: Destination): string => `${d.binderId}:${d.folderId}`;
const none = new Set<string>();

const tick = (mapping: Mapping, files: PageFile[], selected: Set<string>, d: Destination): Mapping =>
  toggleDestination(mapping, files, selected, d);

describe('scope and tick state', () => {
  const files = [file('a'), file('b'), file('c')];

  it('applies a tick to all usable files, or only to the selected ones', () => {
    expect(scopeOf(files, none)).toEqual(['a', 'b', 'c']);
    expect(scopeOf(files, new Set(['b']))).toEqual(['b']);
  });

  it('leaves out a file refused for malware', () => {
    expect(scopeOf([file('a'), file('x', 'infected')], none)).toEqual(['a']);
  });

  it('is on when every file in scope has the folder, mixed when some do, off when none', () => {
    const d = dest(1);
    const some = tick(emptyMapping, files, new Set(['a']), d);
    expect(tickState(some, scopeOf(files, none), key(d))).toBe('mixed');
    expect(tickState(some, scopeOf(files, new Set(['a'])), key(d))).toBe('on');
    expect(tickState(some, scopeOf(files, new Set(['b'])), key(d))).toBe('off');
    const all = tick(some, files, none, d);
    expect(tickState(all, scopeOf(files, none), key(d))).toBe('on');
  });

  it('unticks for the whole scope when it was fully ticked', () => {
    const d = dest(1);
    const on = tick(emptyMapping, files, none, d);
    const off = tick(on, files, none, d);
    expect(deliveryCount(off, files)).toBe(0);
  });

});

describe('folders ticked before any file (D-F1-4)', () => {
  it('holds a folder ticked with no file, shows it ticked, and unticks it', () => {
    const d = dest(1);
    const held = toggleDestination(emptyMapping, [], none, d);
    expect(held.held).toEqual([key(d)]);
    expect(tickState(held, [], key(d))).toBe('on');
    expect(chosenKeys(held, [])).toEqual([key(d)]);
    expect(toggleDestination(held, [], none, d).held).toEqual([]);
  });

  it('sends held folders to every file added while they stay ticked (D-F1-5)', () => {
    const held = toggleDestination(toggleDestination(emptyMapping, [], none, dest(1)), [], none, dest(2));
    const files = [file('a'), file('b')];
    const applied = applyHeld(held, files);
    expect(applied.files).toEqual({ a: [key(dest(1)), key(dest(2))], b: [key(dest(1)), key(dest(2))] });
    expect(applied.held).toEqual([key(dest(1)), key(dest(2))]);
    // A second call changes nothing; a file added later gets the same folders.
    expect(applyHeld(applied, files)).toBe(applied);
    const later = applyHeld(applied, [...files, file('c')]);
    expect(later.files.c).toEqual([key(dest(1)), key(dest(2))]);
    expect(readiness(later, [...files, file('c')]).ready).toBe(true);
  });

  it('stops applying a folder once it is unticked for all files', () => {
    const files = [file('a')];
    let m = applyHeld(toggleDestination(toggleDestination(emptyMapping, [], none, dest(1)), [], none, dest(2)), files);
    m = toggleDestination(m, files, none, dest(1));
    expect(m.held).toEqual([key(dest(2))]);
    expect(applyHeld(m, [...files, file('b')]).files.b).toEqual([key(dest(2))]);
    m = toggleDestination(m, files, none, dest(2));
    expect(m.held).toEqual([]);
  });

  it('keeps a tick for selected files out of the held list', () => {
    const files = [file('a'), file('b')];
    const m = toggleDestination(emptyMapping, files, new Set(['a']), dest(1));
    expect(m.held).toEqual([]);
    expect(m.files.a).toEqual([key(dest(1))]);
  });

  it('waits while there is no usable file, and leaves a file that already has folders alone', () => {
    const held = toggleDestination(emptyMapping, [], none, dest(1));
    expect(applyHeld(held, [])).toBe(held);
    expect(applyHeld(held, [file('x', 'infected')])).toBe(held);
    const mapped = { ...held, files: { a: [key(dest(2))] } };
    expect(applyHeld(mapped, [file('a')])).toBe(mapped);
  });

  it('works in the other order too: files first, then folders', () => {
    const files = [file('a')];
    const mapping = tick(emptyMapping, files, none, dest(1));
    expect(mapping.files.a).toEqual([key(dest(1))]);
    // Ticked for all files, so a file added next gets it too.
    expect(applyHeld(mapping, [...files, file('b')]).files.b).toEqual([key(dest(1))]);
  });
});

describe('limits are checked at Send, not at the tick', () => {
  it('lets a 21st destination be ticked, and Send says why it is off', () => {
    const files = [file('a')];
    let mapping = emptyMapping;
    for (let n = 1; n <= 21; n += 1) mapping = tick(mapping, files, none, dest(n));
    expect(destinationCounts(mapping, files).size).toBe(21);
    const r = readiness(mapping, files);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('A distribution can have at most 20 destinations.');
    // Unticking one makes it valid again.
    expect(readiness(tick(mapping, files, none, dest(21)), files).ready).toBe(true);
  });

  it('counts 100 files x 20 destinations as 2,000 deliveries and sends it', () => {
    const files = Array.from({ length: 100 }, (_, i) => file(`f${i}`));
    let mapping = emptyMapping;
    for (let n = 1; n <= 20; n += 1) mapping = tick(mapping, files, none, dest(n));
    expect(deliveryCount(mapping, files)).toBe(2000);
    expect(destinationCounts(mapping, files).size).toBe(20);
    expect(readiness(mapping, files).ready).toBe(true);
    expect(buildJobRequest(mapping, files)?.mappings).toHaveLength(100);
  });
});

describe('summarise', () => {
  const files = [file('a'), file('b'), file('c')];

  it('counts files with a folder, the distinct folders and teams, and the deliveries', () => {
    const d1 = dest(1);
    const d2 = dest(2);
    let m = tick(emptyMapping, files, new Set(['a', 'b']), d1);
    m = tick(m, files, new Set(['a']), d2);
    const s = summarise(m, files);
    expect(s).toMatchObject({ files: 2, folders: 2, deliveries: 3 });
    expect(s.teams).toBeGreaterThanOrEqual(1);
  });

  it('is empty before anything is ticked', () => {
    expect(summarise(emptyMapping, files)).toEqual({ files: 0, folders: 0, deliveries: 0, teams: 0 });
  });
});

describe('readiness', () => {
  const d = dest(1);

  it('is off with no files, with a file still uploading, or with an unmapped file', () => {
    expect(readiness(emptyMapping, []).ready).toBe(false);
    const files = [file('a'), file('b', 'uploading')];
    expect(readiness(tick(emptyMapping, files, none, d), files).ready).toBe(false);
    const verified = [file('a'), file('b')];
    const partly = tick(emptyMapping, verified, new Set(['a']), d);
    const r = readiness(partly, verified);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('1 file has no folder. Tick a folder');
  });

  it('says why Send is off, in a few words (the button\'s title)', () => {
    expect(readiness(emptyMapping, []).reason).toBe('Add a file first');
    const uploading = [file('a'), file('b', 'uploading'), file('c', 'checking')];
    expect(readiness(tick(emptyMapping, uploading, none, d), uploading).reason).toBe('2 files are not ready yet');
    const one = [file('a', 'checking')];
    expect(readiness(tick(emptyMapping, one, none, d), one).reason).toBe('1 file is not ready yet');
    // A file that will not verify on its own is not "waiting": it needs a retry or to go.
    const stuck = [file('a', 'interrupted'), file('b', 'checking'), file('c', 'unchecked')];
    expect(readiness(tick(emptyMapping, stuck, none, d), stuck).reason).toBe('2 files failed to upload. Retry or remove them');
    const verified = [file('a'), file('b')];
    const partly = tick(emptyMapping, verified, new Set(['a']), d);
    expect(readiness(partly, verified).reason).toBe('1 file has no folder. Tick a folder');
    const bad = [file('a'), file('x', 'infected')];
    expect(readiness(tick(emptyMapping, bad, none, d), bad).reason).toBe('Remove the 1 file refused for malware first');
  });

  it('has no reason when Send is on', () => {
    const files = [file('a')];
    const r = readiness(tick(emptyMapping, files, none, d), files);
    expect(r.ready).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('is off while a file is refused for malware, and says so', () => {
    const files = [file('a'), file('x', 'infected')];
    const r = readiness(tick(emptyMapping, files, none, d), files);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('Remove the 1 file refused for malware first');
  });

  it('is on when every file is verified and mapped', () => {
    const files = [file('a'), file('b')];
    const r = readiness(tick(emptyMapping, files, none, d), files);
    expect(r.ready).toBe(true);
    expect(r.reason).toBeNull();
  });
});

describe('buildJobRequest', () => {
  it('uses the server file ids and always names the folder', () => {
    const files = [file('a')];
    let mapping = tick(emptyMapping, files, none, dest(1));
    mapping = tick(mapping, files, none, dest(2));
    expect(buildJobRequest(mapping, files)).toEqual({
      files: [{ fileId: 'server-a', sha256: 'a'.repeat(64) }],
      mappings: [{ fileId: 'server-a', destinations: [{ binderId: 'b1', folderId: 'f1' }, { binderId: 'b2', folderId: 'f2' }] }],
    });
  });

  it('is null when the batch breaks a limit', () => {
    expect(buildJobRequest(emptyMapping, [file('a')])).toBeNull();
  });
});

describe('describeDestination', () => {
  it('splits a path into the team and the last name', () => {
    expect(describeDestination('Cardio / CARDIO-301 Regulatory / IRB approvals')).toEqual({ team: 'Cardio', name: 'IRB approvals' });
  });
});
