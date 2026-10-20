// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SendBar } from './SendBar.js';

afterEach(cleanup);
const noop = (): void => undefined;
const base = { summary: '2 files to 2 folders: 4 deliveries', error: null, onClear: noop, onSend: noop };

describe('SendBar titles', () => {
  it('says why Send is off, and why Clear is off', () => {
    render(<SendBar {...base} ready={false} reason="Waiting for 2 files to be verified" sending={false} canClear={false} />);
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toBe('Waiting for 2 files to be verified');
    const clear = screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    expect(clear.title).toBe('Nothing to clear');
  });

  it('shows the reason beside the button while Send is off, and nothing once it is on', () => {
    const { rerender } = render(<SendBar {...base} ready={false} reason="Add a file first" sending={false} canClear={false} />);
    expect(screen.getByRole('status').textContent).toBe('Add a file first');
    rerender(<SendBar {...base} ready reason={null} sending={false} canClear />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('has no title on a button that is on', () => {
    render(<SendBar {...base} ready reason={null} sending={false} canClear />);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('title')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear' }).getAttribute('title')).toBeNull();
  });

  it('shows the batch in one line above the reason', () => {
    render(<SendBar {...base} ready={false} reason="Add a file first" sending={false} canClear={false} />);
    expect(screen.getByText('2 files to 2 folders: 4 deliveries')).toBeTruthy();
  });

  it('has no title while sending: the label says it', () => {
    render(<SendBar {...base} ready reason={null} sending canClear />);
    expect(screen.getByRole('button', { name: 'Sending…' }).getAttribute('title')).toBeNull();
  });
});
