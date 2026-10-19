import { describe, expect, it } from 'vitest';
import type { Destination } from '../destinations/selection.js';
import type { FileStatus, PageFile } from '../upload/manager.js';
import {
  buildJobRequest,
  deliveryCount,
  describeDestination,
  destinationCounts,
  emptyMapping,
  readiness,
  removeDestination,
  removeFromDestination,
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

function tick(mapping: Mapping, files: PageFile[], selected: Set<string>, d: Destination): Mapping {
  const out = toggleDestination(mapping, files, selected, d);
  expect(out.refused).toBeUndefined();
  return out.mapping;
}

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

  it('ignores a tick when there are no files', () => {
    expect(toggleDestination(emptyMapping, [], none, dest(1)).mapping).toBe(emptyMapping);
  });
});

describe('limits', () => {
  it('refuses a 21st destination and keeps the mapping as it was', () => {
    const files = [file('a')];
    let mapping = emptyMapping;
    for (let n = 1; n <= 20; n += 1) mapping = tick(mapping, files, none, dest(n));
    const refused = toggleDestination(mapping, files, none, dest(21));
    expect(refused.refused).toBe('A distribution can have at most 20 destinations.');
    expect(refused.mapping).toBe(mapping);
    // An existing destination can still be ticked for another file.
    expect(toggleDestination(mapping, [...files, file('b')], new Set(['b']), dest(3)).refused).toBeUndefined();
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

describe('review', () => {
  const files = [file('a'), file('b')];
  const d1 = dest(1);
  const d2 = dest(2);

  it('drops a file from one folder, and reports when that was its last folder', () => {
    let mapping = tick(emptyMapping, files, none, d1);
    mapping = tick(mapping, files, new Set(['a']), d2);
    const first = removeFromDestination(mapping, 'a', key(d1));
    expect(first.dropped).toBe(false);
    const second = removeFromDestination(first.mapping, 'a', key(d2));
    expect(second.dropped).toBe(true);
  });

  it('removes a whole folder for every file', () => {
    const mapping = removeDestination(tick(emptyMapping, files, none, d1), key(d1));
    expect(destinationCounts(mapping, files).size).toBe(0);
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
    expect(r.checks[2]?.label).toBe('1 file has no destination');
  });

  it('says why Send is off, in a few words (the button\'s title)', () => {
    expect(readiness(emptyMapping, []).reason).toBe('Add a file first');
    const uploading = [file('a'), file('b', 'uploading'), file('c', 'checking')];
    expect(readiness(tick(emptyMapping, uploading, none, d), uploading).reason).toBe('Waiting for 2 files to be verified');
    const one = [file('a', 'checking')];
    expect(readiness(tick(emptyMapping, one, none, d), one).reason).toBe('Waiting for 1 file to be verified');
    const verified = [file('a'), file('b')];
    const partly = tick(emptyMapping, verified, new Set(['a']), d);
    expect(readiness(partly, verified).reason).toBe('1 file has no destination yet. Tick a folder');
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
    expect(r.checks[1]?.label).toBe('1 file was refused for malware: remove to continue');
  });

  it('is on when every file is verified and mapped', () => {
    const files = [file('a'), file('b')];
    const r = readiness(tick(emptyMapping, files, none, d), files);
    expect(r.ready).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
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
