import { describe, expect, it } from 'vitest';
import { cutPage, decodeCursor, encodeCursor, readPageQuery } from './paging.js';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('cursor', () => {
  it('round-trips a position, including names with quotes, commas and non-ASCII letters', () => {
    for (const name of ['Cardio', 'a"b,c', 'Zürich / Ω', '']) {
      const position = { rank: 1 as const, name, id: id(7) };
      expect(decodeCursor(encodeCursor(position))).toEqual(position);
    }
  });

  it('is opaque: URL-safe text that does not show the name', () => {
    const cursor = encodeCursor({ rank: 0, name: 'Cardio', id: id(1) });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain('Cardio');
  });

  it.each([
    ['not base64 json', '%%%'],
    ['json that is not a triple', Buffer.from('{"a":1}').toString('base64url')],
    ['a rank that is not 0 or 1', Buffer.from(JSON.stringify([2, 'x', id(1)])).toString('base64url')],
    ['a name that is not text', Buffer.from(JSON.stringify([0, 5, id(1)])).toString('base64url')],
    ['an id that is not a uuid', Buffer.from(JSON.stringify([0, 'x', 'nope'])).toString('base64url')],
    ['an empty string', ''],
  ])('refuses %s with a 400', (_label, bad) => {
    expect(() => readPageQuery({ cursor: bad })).toThrow(expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }));
  });
});

describe('limit', () => {
  it('defaults to 20 and has no cursor', () => {
    expect(readPageQuery({})).toEqual({ limit: 20, after: null });
    expect(readPageQuery(undefined)).toEqual({ limit: 20, after: null });
  });

  it('accepts 1 to 100', () => {
    expect(readPageQuery({ limit: '1' }).limit).toBe(1);
    expect(readPageQuery({ limit: '100' }).limit).toBe(100);
  });

  it.each(['0', '101', '-1', '2.5', 'ten', '', '99999'])('refuses limit %j with a 400', (limit) => {
    expect(() => readPageQuery({ limit })).toThrow(expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }));
  });

  it('refuses a repeated limit', () => {
    expect(() => readPageQuery({ limit: ['1', '2'] })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('cutPage', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: id(i + 1), name: `n${i + 1}` }));

  it('gives a cursor at the last row when one more row exists', () => {
    const page = cutPage(rows(4), 3, () => 0);
    expect(page.rows).toHaveLength(3);
    expect(decodeCursor(page.nextCursor as string)).toEqual({ rank: 0, name: 'n3', id: id(3) });
  });

  it('gives null on the last page, whether it is full or short', () => {
    expect(cutPage(rows(3), 3, () => 0).nextCursor).toBeNull();
    expect(cutPage(rows(2), 3, () => 0).nextCursor).toBeNull();
    expect(cutPage([], 3, () => 0)).toEqual({ rows: [], nextCursor: null });
  });

  it('carries the rank of the last row, so a page can end between folders and documents', () => {
    const page = cutPage(rows(2), 1, () => 1);
    expect(decodeCursor(page.nextCursor as string).rank).toBe(1);
  });
});
