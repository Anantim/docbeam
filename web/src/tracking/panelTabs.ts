import type { Counts, TaskKind } from './api.js';

/** A status tab of the side panel: "all" or one delivery status. */
export type TabId = TaskKind | 'all';

/** The fixed order of the tabs. A delivery that is Retrying counts as In progress. */
export const TAB_ORDER: readonly TabId[] = ['all', 'completed', 'failed', 'in_progress', 'pending', 'cancelled'];

export const TAB_LABEL: Record<TabId, string> = {
  all: 'All',
  completed: 'Completed',
  failed: 'Failed',
  in_progress: 'In progress',
  pending: 'Pending',
  cancelled: 'Cancelled',
};

export const total = (c: Counts): number => c.pending + c.in_progress + c.completed + c.failed + c.cancelled;

/** How many deliveries a tab counts. */
export const tabCount = (c: Counts, id: TabId): number => (id === 'all' ? total(c) : c[id]);

/**
 * The tabs to show and the one that is selected (D-F1-77):
 * - Completed is always shown, even at 0.
 * - All is shown unless Completed is the only status with a count above 0; then only Completed is shown, and it is selected
 *   (the default is All, or Completed when it is the only tab).
 * - Failed, In progress, Pending and Cancelled are shown when their count is above 0.
 * - The tab that is selected stays, even when its count drops to 0 during live updates, until another one is picked. This
 *   also shows a tab asked for by a link, with its count, when it would otherwise be hidden.
 */
export function tabsFor(c: Counts, selected: TabId): { tabs: TabId[]; selected: TabId } {
  const onlyCompleted = c.completed > 0 && total(c) === c.completed;
  const chosen: TabId = onlyCompleted && selected === 'all' ? 'completed' : selected;
  const tabs = TAB_ORDER.filter((id) => {
    if (id === 'completed') return true;
    if (id === 'all') return !onlyCompleted;
    return tabCount(c, id) > 0 || id === chosen;
  });
  return { tabs, selected: chosen };
}
