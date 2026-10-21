// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { tooltipOf } from '../testing/tooltip.js';
import { barText, JobBar } from './JobBar.js';
import { runningText, Shell } from './Shell.js';
import { TypeBadge } from './TypeBadge.js';

afterEach(cleanup);

const counts = (over: Partial<Record<'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled', number>> = {}) => ({
  pending: 0,
  in_progress: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  ...over,
});

describe('the progress bar says its counts in words (D-F1-72)', () => {
  it('lists only the non-zero counts, failed first and completed last of the four', () => {
    expect(barText(counts({ completed: 1, failed: 1, in_progress: 1, cancelled: 1 }), 4)).toBe('4 deliveries: 1 failed, 1 in progress, 1 cancelled, 1 completed');
    expect(barText(counts({ completed: 3 }), 3)).toBe('3 deliveries: 3 completed');
    expect(barText(counts({ pending: 1 }), 1)).toBe('1 delivery: 1 pending');
  });

  it('uses the same text as the tooltip and the accessible name', () => {
    render(<JobBar counts={counts({ failed: 2, completed: 8 })} total={10} />);
    const bar = screen.getByRole('img', { name: '10 deliveries: 2 failed, 8 completed' });
    expect(tooltipOf(bar)).toBe('10 deliveries: 2 failed, 8 completed');
  });

  it('is a Tab stop only where asked (the panel), not in a list row', () => {
    const { rerender } = render(<JobBar counts={counts({ completed: 1 })} total={1} />);
    expect(screen.getByRole('img').getAttribute('tabindex')).toBeNull();
    rerender(<JobBar counts={counts({ completed: 1 })} total={1} focusable />);
    expect(screen.getByRole('img').getAttribute('tabindex')).toBe('0');
    expect(tooltipOf(screen.getByRole('img'))).toBe('1 delivery: 1 completed');
  });
});

describe('the Status tab badge (D-F1-72)', () => {
  const claims = { sub: 's', email: 'a@example.com', name: 'Anantim Patil', exp: 9_999_999_999 };
  const shell = (running: number) => (
    <Shell claims={claims} teams={['Cardio']} view="distribute" onView={() => undefined} running={running}>
      <p>page</p>
    </Shell>
  );

  it('says "1 distribution still running" and "3 distributions still running"', () => {
    expect(runningText(1)).toBe('1 distribution still running');
    expect(runningText(3)).toBe('3 distributions still running');
    const { rerender } = render(shell(1));
    expect(tooltipOf(screen.getByRole('img', { name: '1 distribution still running' }))).toBe('1 distribution still running');
    rerender(shell(3));
    expect(tooltipOf(screen.getByRole('img', { name: '3 distributions still running' }))).toBe('3 distributions still running');
  });

  it('shows it on hover too', async () => {
    render(shell(2));
    await userEvent.setup().hover(screen.getByRole('img', { name: '2 distributions still running' }));
    expect((await screen.findByRole('tooltip')).textContent).toBe('2 distributions still running');
  });
});

describe('the file type tag (D-F1-72)', () => {
  it('says where the type comes from, on hover and on focus', async () => {
    render(<TypeBadge contentType="application/pdf" />);
    const tag = screen.getByText('PDF');
    expect(tooltipOf(tag)).toBe("Type read from the file's contents");
    await userEvent.setup().hover(tag);
    expect((await screen.findByRole('tooltip')).textContent).toBe("Type read from the file's contents");
  });
});
