import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashFile } from './hashing.js';

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('hashFile', () => {
  it('matches the known SHA-256 of the empty file and of "abc"', async () => {
    expect((await hashFile(new Blob([]), false)).sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect((await hashFile(new Blob(['abc']), false)).sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('gives no part hashes for a file that uploads in one piece', async () => {
    expect((await hashFile(new Blob(['abc']), false)).parts).toEqual([]);
  });

  it('hashes each 16 MiB part and the whole file in one pass', async () => {
    const part = 16 * 1024 ** 2;
    const bytes = new Uint8Array(part * 2 + 1000).map((_, i) => (i * 31) % 251);
    const progress: number[] = [];
    const result = await hashFile(new Blob([bytes]), true, (f) => progress.push(f));

    expect(result.sha256).toBe(sha(bytes));
    expect(result.parts).toEqual([sha(bytes.slice(0, part)), sha(bytes.slice(part, part * 2)), sha(bytes.slice(part * 2))]);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    // 32 MiB is built and hashed twice in this test, which takes seconds on a busy CPU: allow 20 s, not the default 5 s.
  }, 20_000);
});
