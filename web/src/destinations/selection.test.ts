import { describe, expect, it } from 'vitest';
import { destinationKey, MAX_DESTINATIONS, toggle, type Destination } from './selection.js';

const dest = (n: number): Destination => ({ binderId: 'b', folderId: `f${n}`, path: `p${n}` });

describe('destination selection', () => {
  it('ticks and unticks', () => {
    const one = toggle([], dest(1));
    expect(one.selected).toHaveLength(1);
    expect(toggle(one.selected, dest(1)).selected).toHaveLength(0);
  });

  it('refuses the 21st destination and keeps the 20', () => {
    let selected: Destination[] = [];
    for (let i = 0; i < MAX_DESTINATIONS; i++) selected = toggle(selected, dest(i)).selected;
    expect(selected).toHaveLength(20);
    const refused = toggle(selected, dest(99));
    expect(refused.refused).toBe(true);
    expect(refused.selected).toHaveLength(20);
  });

  it('lets a ticked destination be removed when 20 are chosen', () => {
    let selected: Destination[] = [];
    for (let i = 0; i < 20; i++) selected = toggle(selected, dest(i)).selected;
    const after = toggle(selected, dest(3));
    expect(after.refused).toBe(false);
    expect(after.selected).toHaveLength(19);
  });

  it('keys a binder top level apart from a folder', () => {
    expect(destinationKey({ binderId: 'b', folderId: null })).not.toBe(destinationKey({ binderId: 'b', folderId: 'f' }));
  });
});
