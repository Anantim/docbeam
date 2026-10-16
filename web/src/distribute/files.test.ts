import { describe, expect, it } from 'vitest';
import { acceptFiles, formatSize } from './files.js';

const file = (name: string, size = 10): File => {
  const f = new File([new Uint8Array(1)], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('acceptFiles', () => {
  it('accepts the five allowed types by extension, in any case', () => {
    const { accepted, rejected } = acceptFiles(0, ['a.pdf', 'b.DOCX', 'c.xlsx', 'd.png', 'e.JPG', 'f.jpeg'].map((n) => file(n)));
    expect(accepted.map((a) => a.file.name)).toEqual(['a.pdf', 'b.DOCX', 'c.xlsx', 'd.png', 'e.JPG', 'f.jpeg']);
    expect(rejected).toEqual([]);
    expect(accepted[1]?.contentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('refuses other types, empty files and files over 1 GB, each with a reason', () => {
    const { accepted, rejected } = acceptFiles(0, [file('setup.exe'), file('empty.pdf', 0), file('huge.pdf', 1024 ** 3 + 1), file('ok.pdf', 1024 ** 3)]);
    expect(accepted.map((a) => a.file.name)).toEqual(['ok.pdf']);
    expect(rejected.map((r) => r.name)).toEqual(['setup.exe', 'empty.pdf', 'huge.pdf']);
    expect(rejected[0]?.reason).toContain('not allowed');
    expect(rejected[1]?.reason).toContain('empty');
    expect(rejected[2]?.reason).toContain('1 GB');
  });

  it('stops at 100 files counting the ones already on the page', () => {
    const picked = Array.from({ length: 5 }, (_, i) => file(`f${i}.pdf`));
    const { accepted, rejected } = acceptFiles(97, picked);
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.reason).toContain('at most 100 files');
  });
});

describe('formatSize', () => {
  it('uses KB, MB and GB with 1,024 steps', () => {
    expect(formatSize(300)).toBe('1 KB');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(1.5 * 1024 ** 2)).toBe('1.5 MB');
    expect(formatSize(120 * 1024 ** 2)).toBe('120 MB');
    expect(formatSize(1024 ** 3)).toBe('1.0 GB');
  });
});
