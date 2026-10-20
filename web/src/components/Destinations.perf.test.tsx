// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destinationKey, type Destination } from '../destinations/selection.js';
import type * as IconsModule from './Icons.js';

// Render counting for the destination tree (F1 follow-up, vercel-react-best-practices): every folder row draws one
// FolderIcon, so the number of FolderIcon renders is the number of folder rows that were drawn again.
const renders = vi.hoisted(() => ({ folder: 0 }));
vi.mock('./Icons.js', async (importOriginal) => ({
  ...(await importOriginal<typeof IconsModule>()),
  FolderIcon: () => {
    renders.folder += 1;
    return <svg />;
  },
}));

const apiFetch = vi.fn();
vi.mock('../auth/session.js', () => ({ apiFetch: (path: string) => apiFetch(path) }));
const { Destinations } = await import('./Destinations.js');

const FOLDERS = 40;
beforeEach(() => {
  renders.folder = 0;
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/teams') return { items: [{ id: 't', name: 'Team' }], nextCursor: null };
    if (path === '/teams/t/binders') return { items: [{ id: 'b', name: 'Binder' }], nextCursor: null };
    if (path === '/binders/b/contents') {
      return { folders: Array.from({ length: FOLDERS }, (_, i) => ({ id: `f${i}`, name: `Folder ${String(i).padStart(2, '0')}` })), documents: [], nextCursor: null };
    }
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(cleanup);

/** A parent like Distribute: it ticks on a click and gives the tree a new function for the tick state each render. */
function Parent() {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (d: Destination): void =>
    setTicked((t) => {
      const next = new Set(t);
      if (!next.delete(destinationKey(d))) next.add(destinationKey(d));
      return next;
    });
  return <Destinations onToggle={toggle} onTeams={() => undefined} stateOf={(d) => (ticked.has(destinationKey(d)) ? 'on' : 'off')} />;
}

describe('the destination tree redraws only what changed', () => {
  it('ticking one folder of 40 draws that row again, not the other 39', async () => {
    const user = userEvent.setup();
    render(<Parent />);
    await user.click(await screen.findByRole('button', { name: 'Expand Team' }));
    await user.click(await screen.findByRole('button', { name: 'Expand Binder' }));
    await screen.findByText('Folder 39');
    expect(renders.folder).toBeGreaterThanOrEqual(FOLDERS);
    renders.folder = 0;
    await user.click(screen.getByRole('checkbox', { name: /Folder 07$/ }));
    expect(screen.getByRole('checkbox', { name: /Folder 07$/ }).getAttribute('aria-checked')).toBe('true');
    // Before the fix this was 40: every row was drawn again for each tick.
    expect(renders.folder).toBeLessThanOrEqual(2);
  });
});
