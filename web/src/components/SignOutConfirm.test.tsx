// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageFile } from '../upload/manager.js';

const logout = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../auth/session.js', () => ({ logout }));

const { Shell } = await import('./Shell.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const claims = { sub: 's', email: 'a@example.com', name: 'Anantim Patil', exp: 9_999_999_999 };
const file = (name: string, status: PageFile['status']): PageFile =>
  ({ id: name, file: new File([], name), name, sizeBytes: 1, contentType: 'application/pdf', status, progress: 0, partCount: 0, partsDone: 0 }) as PageFile;
const manager = (files: PageFile[]) => ({ subscribe: () => () => undefined, getSnapshot: () => files });

const show = (files: PageFile[]) =>
  render(
    <Shell claims={claims} teams={['Cardio']} view="distribute" onView={() => undefined} manager={manager(files)}>
      <h1>New distribution</h1>
    </Shell>,
  );

describe('Sign out while a file is still being read or uploaded (D-F1-78)', () => {
  it('asks first, naming how many uploads stop; "Stay" keeps the session and gives the focus back to Sign out', async () => {
    const user = userEvent.setup();
    show([file('a.pdf', 'uploading'), file('b.pdf', 'hashing'), file('c.pdf', 'verified')]);
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    await user.click(signOut);
    const dialog = screen.getByRole('dialog', { name: 'Sign out and stop 2 uploads?' });
    expect(logout).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(logout).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(signOut); // back on the control that opened the dialog
  });

  it('says "1 upload" for one, and "Sign out" signs out', async () => {
    const user = userEvent.setup();
    show([file('a.pdf', 'interrupted')]);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = screen.getByRole('dialog', { name: 'Sign out and stop 1 upload?' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Stay' })); // the safe answer has the focus
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('signs out at once when nothing is at risk: no files, or files that are stored and scanned', async () => {
    const user = userEvent.setup();
    show([]);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(logout).toHaveBeenCalledTimes(1);
    cleanup();
    show([file('a.pdf', 'verified'), file('b.pdf', 'checking')]);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc answers "Stay"', async () => {
    const user = userEvent.setup();
    show([file('a.pdf', 'uploading')]);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });
});
