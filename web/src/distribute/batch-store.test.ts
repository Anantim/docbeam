// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageFile } from '../upload/manager.js';
import { clearBatch, loadBatch, saveBatch } from './batch-store.js';
import { emptyMapping, type Mapping } from './mapping.js';

const file = (id: string, status: PageFile['status'], serverId?: string): PageFile => ({
  id,
  file: new File([], `${id}.pdf`),
  name: `${id}.pdf`,
  sizeBytes: 10,
  contentType: 'application/pdf',
  status,
  progress: 1,
  partsDone: 0,
  partCount: 0,
  sha256: 'a'.repeat(64),
  ...(serverId ? { serverId } : {}),
});
const dest = { binderId: 'b', folderId: 'f', path: 'Cardio / R / IRB' };
const mapping: Mapping = { destinations: { k: dest }, files: { p1: ['k'], p2: ['k'], gone: ['k'] }, held: ['k'] };

beforeEach(() => sessionStorage.clear());

describe('the stored batch (D-F1-66)', () => {
  it('keeps every file, whether its upload had finished, with the ticks of the files that are on the page and the held folders', () => {
    saveBatch([file('p1', 'verified', 's1'), file('p2', 'uploading', 's2')], mapping);
    const batch = loadBatch()!;
    expect(batch.files.map((f) => [f.id, f.stored])).toEqual([['p1', true], ['p2', false]]);
    expect(Object.keys(batch.mapping.files)).toEqual(['p1', 'p2']); // "gone" is not on the page
    expect(batch.mapping.held).toEqual(['k']);
    expect(batch.mapping.destinations.k).toEqual(dest);
  });

  it('keeps a file that is being scanned as stored, and leaves a refused one out', () => {
    saveBatch([file('p1', 'checking', 's1'), file('p2', 'infected', 's2')], mapping);
    expect(loadBatch()!.files.map((f) => [f.id, f.stored])).toEqual([['p1', true]]);
  });

  it('keeps folders ticked before any file was added', () => {
    saveBatch([], { ...emptyMapping, destinations: { k: dest }, held: ['k'] });
    expect(loadBatch()!.files).toEqual([]);
    expect(loadBatch()!.mapping.held).toEqual(['k']);
  });

  it('forgets the batch when the page is empty, and on clearBatch', () => {
    saveBatch([file('p1', 'verified', 's1')], mapping);
    saveBatch([], emptyMapping);
    expect(loadBatch()).toBeNull();
    saveBatch([file('p1', 'verified', 's1')], mapping);
    clearBatch();
    expect(loadBatch()).toBeNull();
  });

  it('ignores a stored value that is not a batch, and a storage that throws', () => {
    sessionStorage.setItem('docbeam.batch.v1', '{"files": 3}');
    expect(loadBatch()).toBeNull();
    sessionStorage.setItem('docbeam.batch.v1', 'not json');
    expect(loadBatch()).toBeNull();
    const broken = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => saveBatch([file('p1', 'verified', 's1')], mapping)).not.toThrow();
    broken.mockRestore();
  });
});
