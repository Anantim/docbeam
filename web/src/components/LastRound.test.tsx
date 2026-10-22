// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageTitle } from '../App.js';
import { num, plural } from '../text.js';
import { addToast, TOAST_MAX, TOAST_MS, Toasts, type Toast } from './Toasts.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { Shell } from './Shell.js';
import { Tooltip } from './Tooltip.js';
import { barText } from './JobBar.js';
import { TeamChips } from './TeamChips.js';

// The small rules of the last round (D-F1-81): toasts, the offline note, tooltips only when asked for, page titles, one number format.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('toasts', () => {
  const ok = (id: number, text = `ok ${id}`): Toast => ({ id, text, kind: 'ok' });
  const bad = (id: number, text = `bad ${id}`): Toast => ({ id, text, kind: 'error' });

  function Host({ start }: { start: Toast[] }) {
    const [toasts, set] = useState(start);
    return <Toasts toasts={toasts} onClose={(id) => set((t) => t.filter((x) => x.id !== id))} />;
  }

  it('keeps an error toast until it is closed, with a small Close icon', async () => {
    vi.useFakeTimers();
    render(<Host start={[bad(1, "The link couldn't be copied.")]} />);
    await act(async () => vi.advanceTimersByTimeAsync(TOAST_MS * 5));
    const toast = screen.getByRole('alert');
    expect(toast.textContent).toContain("The link couldn't be copied.");
    const close = within(toast).getByRole('button', { name: /^Close message/ });
    expect(close.className).toBe('icon small toast-close');
    fireEvent.click(close);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fades a success toast after 4 seconds, which has no Close icon', async () => {
    vi.useFakeTimers();
    render(<Host start={[ok(1, 'Sent')]} />);
    expect(within(screen.getByRole('status')).queryByRole('button')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(TOAST_MS - 100));
    expect(screen.getByText('Sent')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(screen.queryByText('Sent')).toBeNull();
  });

  it('stops the clock while the pointer is over a success toast, or it has the focus, and carries on from where it was', async () => {
    vi.useFakeTimers();
    render(<Host start={[ok(1, 'Sent')]} />);
    const toast = screen.getByText('Sent').closest('.toast') as HTMLElement;
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    fireEvent.mouseEnter(toast);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByText('Sent')).toBeTruthy(); // held
    fireEvent.mouseLeave(toast);
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(screen.getByText('Sent')).toBeTruthy(); // 1 second was left, not 4 again
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(screen.queryByText('Sent')).toBeNull();
    // Focus holds it too.
    cleanup();
    render(<Host start={[ok(2, 'Copied')]} />);
    const second = screen.getByText('Copied').closest('.toast') as HTMLElement;
    fireEvent.focus(second);
    await act(async () => vi.advanceTimersByTimeAsync(TOAST_MS * 3));
    expect(screen.getByText('Copied')).toBeTruthy();
    fireEvent.blur(second);
    await act(async () => vi.advanceTimersByTimeAsync(TOAST_MS + 100));
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('shows at most 3, and the oldest goes first', () => {
    let list: Toast[] = [];
    for (let i = 1; i <= 5; i += 1) list = addToast(list, i % 2 ? bad(i) : ok(i));
    expect(TOAST_MAX).toBe(3);
    expect(list.map((t) => t.id)).toEqual([3, 4, 5]);
  });
});

describe('the offline note', () => {
  const claims = { sub: 'u', name: 'Priya Shah', email: 'p@example.test', exp: 0 };
  const setOnline = (value: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
  afterEach(() => setOnline(true));

  it('shows one info note under the header while the browser is offline, and takes it away when it is back', async () => {
    setOnline(true);
    render(
      <Shell claims={claims} teams={[]} view="status" onView={() => undefined}>
        <main>page</main>
      </Shell>,
    );
    expect(screen.queryByText(/You're offline/)).toBeNull();
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    const note = screen.getByText("You're offline. Uploads and live updates carry on when you're back.");
    expect(note.closest('.notice')?.classList.contains('info')).toBe(true);
    expect(screen.getAllByText(/You're offline/)).toHaveLength(1);
    // It sits between the header and the page.
    const header = document.querySelector('header') as HTMLElement;
    expect(header.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });
});

describe('page titles', () => {
  it('follows the page: Distribute, Status, and a distribution\'s first 8 characters', () => {
    expect(pageTitle({ view: 'distribute', jobId: null, filters: {} })).toBe('Distribute · DocBeam');
    expect(pageTitle({ view: 'status', jobId: null, filters: {} })).toBe('Status · DocBeam');
    expect(pageTitle({ view: 'status', jobId: '3f1c2a9e-84d5-4b6a-9c11-0a5f6d7e8b90', filters: {} })).toBe('3f1c2a9e · Status · DocBeam');
  });
});

describe('tooltips only when asked for (D-F1-81)', () => {
  // Real timers: the pause before a hover tooltip is 300 ms, and user-event does not run under fake ones.
  const wait = (ms: number) => act(async () => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const Trigger = () => (
    <Tooltip text="Open by ID">
      <button type="button">Open by ID</button>
    </Tooltip>
  );

  it('shows nothing when the app moves the focus (a dialog opening, or the focus returning after Esc)', async () => {
    render(<Trigger />);
    act(() => screen.getByRole('button').focus()); // no key before it
    await wait(500);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows it at once when Tab moves the focus there', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Trigger />);
    await user.tab();
    expect(screen.getByRole('tooltip').textContent).toBe('Open by ID');
  });

  it('shows it on hover after the pause', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Trigger />);
    await user.hover(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });

  it('closes an open tooltip at once, with no fade, when a dialog opens', async () => {
    const user = userEvent.setup({ delay: null });
    function Both() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Trigger />
          <button type="button" onClick={() => setOpen(true)}>
            ask
          </button>
          {open && (
            <ConfirmDialog heading="Sure?" confirmLabel="Yes" cancelLabel="No" onConfirm={() => undefined} onCancel={() => setOpen(false)}>
              <p>Really.</p>
            </ConfirmDialog>
          )}
        </>
      );
    }
    render(<Both />);
    await user.tab(); // the tooltip of the first button shows
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'ask' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('tooltip')).toBeNull(); // gone in the same moment, not after the 80 ms fade
    expect(document.querySelector('.tooltip.leaving')).toBeNull();
  });

  it('shows no tooltip for the focus that returns to the opener after Esc', async () => {
    const user = userEvent.setup({ delay: null });
    function Both() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Tooltip text="Open by ID">
            <button type="button" onClick={() => setOpen(true)}>
              Open by ID
            </button>
          </Tooltip>
          {open && (
            <ConfirmDialog heading="Sure?" confirmLabel="Yes" cancelLabel="No" onConfirm={() => undefined} onCancel={() => setOpen(false)}>
              <p>Really.</p>
            </ConfirmDialog>
          )}
        </>
      );
    }
    render(<Both />);
    await user.tab(); // the keyboard reaches the button: its tooltip shows once
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.keyboard('{Enter}'); // the dialog opens and the tooltip goes
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open by ID' }));
    await wait(500);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('one number format (D-F1-81)', () => {
  it('writes every count with a thousands separator', () => {
    expect(num(2000)).toBe('2,000');
    expect(num(999)).toBe('999');
    expect(num(1234567)).toBe('1,234,567');
    expect(plural(2000, 'delivery', 'deliveries')).toBe('2,000 deliveries');
    expect(plural(1, 'delivery', 'deliveries')).toBe('1 delivery');
    expect(plural(0, 'file', 'files')).toBe('0 files');
  });

  it('is used in the progress bar words and in the +N of a long team list', () => {
    expect(barText({ pending: 0, in_progress: 0, completed: 2000, failed: 0, cancelled: 0 }, 2000)).toBe('2,000 deliveries: 2,000 completed');
    render(<TeamChips teams={Array.from({ length: 1500 }, (_, i) => `Team ${i}`)} />);
    const more = screen.queryByRole('button', { name: /^Show all/ });
    if (more) expect(more.getAttribute('aria-label')).toBe('Show all 1,500 teams');
  });
});

describe('plural words next to a count', () => {
  it('uses the singular for one: "1 file", "1 folder", "1 more file"', () => {
    expect(plural(1, 'file', 'files')).toBe('1 file');
    expect(plural(1, 'more file', 'more files')).toBe('1 more file');
    expect(plural(2, 'more folder', 'more folders')).toBe('2 more folders');
  });
});
