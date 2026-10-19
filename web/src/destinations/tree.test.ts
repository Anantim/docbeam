import { describe, expect, it } from 'vitest';
import { destinationFor, pageUrl, visibleIds, type Loaded, type TreeNode } from './tree.js';

const team: TreeNode = { id: 't1', kind: 'team', name: 'Cardio', binderId: null, pathNames: ['Cardio'] };
const binder: TreeNode = { id: 'b1', kind: 'binder', name: 'CARDIO-301 Regulatory', binderId: 'b1', pathNames: ['Cardio', 'CARDIO-301 Regulatory'] };
const folder: TreeNode = {
  id: 'f1',
  kind: 'folder',
  name: 'Protocol amendments',
  binderId: 'b1',
  pathNames: ['Cardio', 'CARDIO-301 Regulatory', 'Protocol amendments'],
};
const other: TreeNode = { id: 'f2', kind: 'folder', name: 'IRB approvals', binderId: 'b1', pathNames: ['Cardio', 'CARDIO-301 Regulatory', 'IRB approvals'] };
const loaded = new Map<string, Loaded>([
  ['t1', { children: [binder], nextCursor: null }],
  ['b1', { children: [folder, other], nextCursor: null }],
]);

describe('destination tree', () => {
  it('shows everything when the filter is empty', () => {
    expect(visibleIds([team], loaded, '  ')).toBeNull();
  });

  it('keeps a match and the parents that lead to it', () => {
    const keep = visibleIds([team], loaded, 'AMEND');
    expect([...keep!].sort()).toEqual(['b1', 'f1', 't1']);
  });

  it('returns nothing when no loaded node matches', () => {
    expect(visibleIds([team], loaded, 'zzz')!.size).toBe(0);
  });

  it('turns a folder into a destination with its path; teams and binders are not destinations', () => {
    expect(destinationFor(team)).toBeNull();
    expect(destinationFor(binder)).toBeNull();
    expect(destinationFor(folder)).toEqual({
      binderId: 'b1',
      folderId: 'f1',
      path: 'Cardio / CARDIO-301 Regulatory / Protocol amendments',
    });
  });
});

describe('pageUrl', () => {
  it('is the plain route for the first page, and carries the cursor, escaped, for the next', () => {
    expect(pageUrl('/teams', null)).toBe('/teams');
    expect(pageUrl('/teams', 'ab_-9')).toBe('/teams?cursor=ab_-9');
    expect(pageUrl('/teams', 'a+b/c=')).toBe('/teams?cursor=a%2Bb%2Fc%3D');
  });
});
