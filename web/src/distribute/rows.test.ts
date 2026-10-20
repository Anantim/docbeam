import { describe, expect, it } from 'vitest';
import { keepSelected, pickRow, type Pick } from './rows.js';

const order = ['a', 'b', 'c', 'd', 'e'];
const none: Pick = { selected: new Set(), anchor: null };
const click = { shift: false, ctrl: false };

describe('pickRow', () => {
  it('a plain click toggles that row without changing the others: no Ctrl needed (D-F1-36)', () => {
    const one = pickRow(none, order, 'b', click);
    expect([...one.selected]).toEqual(['b']);
    const two = pickRow(one, order, 'c', click);
    expect([...two.selected].sort()).toEqual(['b', 'c']); // b stays
    const three = pickRow(two, order, 'e', click);
    expect([...three.selected].sort()).toEqual(['b', 'c', 'e']);
    expect([...pickRow(three, order, 'c', click).selected].sort()).toEqual(['b', 'e']); // a second click on c takes only c off
    expect(pickRow(one, order, 'b', click).selected.size).toBe(0);
  });

  it('Ctrl adds and removes single rows and moves the anchor', () => {
    let p = pickRow(none, order, 'a', click);
    p = pickRow(p, order, 'c', { shift: false, ctrl: true });
    expect([...p.selected].sort()).toEqual(['a', 'c']);
    expect(p.anchor).toBe('c');
    p = pickRow(p, order, 'a', { shift: false, ctrl: true });
    expect([...p.selected]).toEqual(['c']);
  });

  it('Shift selects the range from the anchor, in either direction, and keeps the anchor', () => {
    const start = pickRow(none, order, 'b', click);
    const down = pickRow(start, order, 'd', { shift: true, ctrl: false });
    expect([...down.selected]).toEqual(['b', 'c', 'd']);
    const up = pickRow(down, order, 'a', { shift: true, ctrl: false });
    expect([...up.selected]).toEqual(['a', 'b']); // replaces: the anchor is still b
    expect(up.anchor).toBe('b');
  });

  it('Ctrl and Shift add a range to what is selected', () => {
    let p = pickRow(none, order, 'a', click);
    p = pickRow(p, order, 'e', { shift: false, ctrl: true });
    p = pickRow({ ...p, anchor: 'c' }, order, 'd', { shift: true, ctrl: true });
    expect([...p.selected].sort()).toEqual(['a', 'c', 'd', 'e']);
  });

  it('Shift with no anchor acts as a plain click', () => {
    expect([...pickRow(none, order, 'c', { shift: true, ctrl: false }).selected]).toEqual(['c']);
  });
});

describe('keepSelected', () => {
  it('drops rows that are no longer on the page', () => {
    expect([...keepSelected(new Set(['a', 'x']), order)]).toEqual(['a']);
  });
});
