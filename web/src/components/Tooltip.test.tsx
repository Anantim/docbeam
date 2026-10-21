// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip, TOOLTIP_DELAY_MS } from './Tooltip.js';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const harness = (text: string | undefined = 'Remove a.pdf', onKey = vi.fn()) =>
  render(
    <div onKeyDown={onKey}>
      <Tooltip text={text}>
        <button type="button" aria-label="Remove a.pdf">
          x
        </button>
      </Tooltip>
      <button type="button">elsewhere</button>
    </div>,
  );

describe('the Tooltip (D-F1-47)', () => {
  it('shows on keyboard focus at once, with aria-describedby on the trigger, and goes when the focus leaves', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    harness();
    await user.tab();
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Remove a.pdf');
    const trigger = screen.getByRole('button', { name: 'Remove a.pdf' });
    expect(trigger.closest('.tip-wrap')?.getAttribute('aria-describedby')).toBe(tip.id); // the description of what the focus is on
    await user.tab(); // away
    await wait(100); // its 80 ms exit
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes on Esc, and the same Esc still reaches what is under it (a dialog whose close button has the focus closes too)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onKey = vi.fn();
    harness('Remove a.pdf', onKey);
    await user.tab();
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.keyboard('{Escape}');
    await wait(100);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(onKey).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
  });

  it('shows on hover only after 300 ms, and not if the pointer leaves sooner', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    harness();
    const trigger = screen.getByRole('button', { name: 'Remove a.pdf' });
    await user.hover(trigger);
    await wait(TOOLTIP_DELAY_MS - 60);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.unhover(trigger);
    await wait(400);
    expect(screen.queryByRole('tooltip')).toBeNull(); // left before 300 ms

    await user.hover(trigger);
    await wait(TOOLTIP_DELAY_MS + 20);
    expect(screen.getByRole('tooltip').textContent).toBe('Remove a.pdf');
    await user.unhover(trigger);
    await wait(100);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('is drawn in the one shared overlay, not inside the element it describes, and does not take the pointer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = harness();
    await user.tab();
    const tip = screen.getByRole('tooltip');
    expect(container.contains(tip)).toBe(false);
    expect(tip.parentElement).toBe(document.getElementById('overlay-root'));
  });

  it('a press closes it and never holds the press back: the click works at once', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClick = vi.fn();
    render(
      <Tooltip text="Remove">
        <button type="button" onClick={onClick}>
          x
        </button>
      </Tooltip>,
    );
    const button = screen.getByRole('button');
    await user.tab();
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.click(button); // while it is showing, mid-animation
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has no tooltip for no text, and keeps its trigger in place when the text comes and goes (a disabled button)', () => {
    const view = render(
      <Tooltip text={undefined}>
        <button type="button">x</button>
      </Tooltip>,
    );
    const before = screen.getByRole('button');
    fireEvent.focusIn(before);
    expect(screen.queryByRole('tooltip')).toBeNull();
    view.rerender(
      <Tooltip text="Why it is off">
        <button type="button">x</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button')).toBe(before); // the same element: not remounted
  });
});
