// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notice } from './Notice.js';

afterEach(cleanup);

describe('the one in-page note (D-F1-78)', () => {
  it('an error is an alert with the alert icon, a bold first line and a muted detail', () => {
    render(<Notice heading="The list couldn't be loaded." detail="The server didn't answer." />);
    const note = screen.getByRole('alert');
    expect(note.classList.contains('notice')).toBe(true);
    expect(note.classList.contains('info')).toBe(false);
    expect(note.querySelector('.notice-icon svg')).not.toBeNull();
    expect(note.querySelector('strong')?.textContent).toBe("The list couldn't be loaded.");
    expect(note.querySelector('.notice-detail')?.textContent).toBe("The server didn't answer.");
  });

  it('an info note is a status, not an alert', () => {
    render(<Notice tone="info" heading="a.pdf is downloading." />);
    expect(screen.queryByRole('alert')).toBeNull();
    const note = screen.getByRole('status');
    expect(note.classList.contains('info')).toBe(true);
  });

  it('"Try again" is a link button after the message, and Close is the small Close icon', async () => {
    const retry = vi.fn();
    const close = vi.fn();
    const user = userEvent.setup();
    render(<Notice heading="Couldn't load more." onRetry={retry} onClose={close} />);
    const again = screen.getByRole('button', { name: 'Try again' });
    expect(again.className).toContain('link');
    await user.click(again);
    expect(retry).toHaveBeenCalledTimes(1);
    const x = screen.getByRole('button', { name: /^Close note: / });
    expect(x.className).toBe('icon small');
    await user.click(x);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('has no Close and no Try again unless asked', () => {
    render(<Notice heading="That's an error." />);
    expect(within(screen.getByRole('alert')).queryByRole('button')).toBeNull();
  });
});
