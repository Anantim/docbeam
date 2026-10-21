import { describe, expect, it } from 'vitest';
import type { Counts } from './api.js';
import { tabCount, tabsFor, type TabId } from './panelTabs.js';

const counts = (over: Partial<Counts> = {}): Counts => ({ pending: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0, ...over });

describe('tabsFor (D-F1-77)', () => {
  it('has a fixed order, and shows every status with a count above 0', () => {
    expect(tabsFor(counts({ completed: 1, failed: 1, in_progress: 1, pending: 1, cancelled: 1 }), 'all').tabs).toEqual(['all', 'completed', 'failed', 'in_progress', 'pending', 'cancelled']);
  });

  it('always shows Completed, even at 0', () => {
    expect(tabsFor(counts({ pending: 4 }), 'all').tabs).toEqual(['all', 'completed', 'pending']);
    expect(tabsFor(counts({ failed: 2 }), 'all').tabs).toEqual(['all', 'completed', 'failed']);
  });

  it('shows All unless Completed is the only status with a count; then only Completed, selected', () => {
    expect(tabsFor(counts({ completed: 10 }), 'all')).toEqual({ tabs: ['completed'], selected: 'completed' });
    expect(tabsFor(counts({ completed: 9, failed: 1 }), 'all').tabs[0]).toBe('all');
    expect(tabsFor(counts(), 'all').tabs).toEqual(['all', 'completed']); // nothing counted yet: Completed is not "the only status with a count"
  });

  it('keeps the selected tab, even at 0, until another is picked; the others at 0 are not shown', () => {
    const c = counts({ completed: 5, pending: 5 });
    expect(tabsFor(c, 'in_progress')).toEqual({ tabs: ['all', 'completed', 'in_progress', 'pending'], selected: 'in_progress' });
    expect(tabsFor(c, 'pending').tabs).toEqual(['all', 'completed', 'pending']);
  });

  it('shows a tab that a link asks for, selected, with its count', () => {
    const c = counts({ completed: 10 });
    const { tabs, selected } = tabsFor(c, 'failed');
    expect(tabs).toEqual(['completed', 'failed']); // All is still hidden: Completed was the only status
    expect(selected).toBe('failed');
    expect(tabCount(c, 'failed')).toBe(0);
  });

  it('counts All as the total, and each other tab as its own count (Retrying is already in In progress)', () => {
    const c = counts({ completed: 4, in_progress: 1, pending: 5 });
    const all: TabId[] = ['all', 'completed', 'failed', 'in_progress', 'pending', 'cancelled'];
    expect(all.map((id) => tabCount(c, id))).toEqual([10, 4, 0, 1, 5, 0]);
  });
});
