import { describe, expect, it } from 'vitest';
import { chainOf, searchUrl, type FolderHit } from './search.js';

const hit: FolderHit = {
  id: 'f2',
  name: '2026',
  path: 'Cardio / CARDIO-301 Regulatory / Protocol amendments / 2026',
  teamId: 't1',
  binderId: 'b1',
  folderIds: ['f1', 'f2'],
};

describe('the folder search helpers (D-F1-67)', () => {
  it('builds the URL with the text trimmed and encoded, and the cursor when there is one', () => {
    expect(searchUrl(' ethics & more ', null)).toBe('/folders/search?q=ethics%20%26%20more');
    expect(searchUrl('ab', 'c/u=r')).toBe('/folders/search?q=ab&cursor=c%2Fu%3Dr');
  });

  it('builds the nodes from the team down to the match, with their paths, so the tree can be opened to it', () => {
    const chain = chainOf(hit);
    expect(chain.map((n) => [n.kind, n.id, n.name])).toEqual([
      ['team', 't1', 'Cardio'],
      ['binder', 'b1', 'CARDIO-301 Regulatory'],
      ['folder', 'f1', 'Protocol amendments'],
      ['folder', 'f2', '2026'],
    ]);
    expect(chain[3]?.pathNames).toEqual(['Cardio', 'CARDIO-301 Regulatory', 'Protocol amendments', '2026']);
    expect(chain.every((n, i) => i < 2 || n.binderId === 'b1')).toBe(true);
  });
});
