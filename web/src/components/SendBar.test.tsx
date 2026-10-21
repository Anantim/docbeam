// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { tooltipOf } from '../testing/tooltip.js';
import { SendBar } from './SendBar.js';

afterEach(cleanup);
const noop = (): void => undefined;
const base = { error: null, onClear: noop, onSend: noop };

describe('SendBar (D-F1-20)', () => {
  it('has Clear and Send and no summary line', () => {
    render(<SendBar {...base} ready reason={null} sending={false} canClear />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.queryByText(/deliveries?$/)).toBeNull();
  });

  it('shows the reason as text beside the buttons and ties it to Send; no tooltip carries it', () => {
    render(<SendBar {...base} ready={false} reason="Choose folders for 2 files" sending={false} canClear />);
    const reason = screen.getByRole('status');
    expect(reason.textContent).toBe('Choose folders for 2 files');
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('aria-describedby')).toBe(reason.id);
    expect(send.getAttribute('title')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear' }).getAttribute('title')).toBeNull();
    // The reason comes before Clear, which comes before Send: immediately left of Clear.
    const order = [...(reason.parentElement as HTMLElement).children];
    expect(order.indexOf(reason)).toBe(0);
    expect(order[1]?.textContent).toBe('Clear');
  });

  it('explains Clear in a tooltip, on hover and on focus (D-F1-72)', async () => {
    render(<SendBar {...base} ready reason={null} sending={false} canClear />);
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(tooltipOf(clear)).toBe('Remove all files and folder ticks');
    await userEvent.setup().hover(clear);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Remove all files and folder ticks');
  });

  it('shows nothing when there is no reason (the empty page) and once Send is on', () => {
    const { rerender } = render(<SendBar {...base} ready={false} reason={null} sending={false} canClear={false} />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-describedby')).toBeNull();
    rerender(<SendBar {...base} ready reason="stale words" sending={false} canClear />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-describedby')).toBeNull();
  });

  it('says Sending… while sending, with no title', () => {
    render(<SendBar {...base} ready reason={null} sending canClear />);
    expect(screen.getByRole('button', { name: 'Sending…' }).getAttribute('title')).toBeNull();
  });
});
