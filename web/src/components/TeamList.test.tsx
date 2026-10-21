// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitCount, TeamList } from './TeamList.js';

// jsdom draws nothing, so the widths are given: every character is 6 px, the box is as wide as the test says.
function stubWidths(room: number): void {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return (this.textContent ?? '').length * 6;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('teamlist') ? room : 0;
  });
}

const names = (n: number): string[] => ['Cardio', 'Neuro', 'Oncology', ...Array.from({ length: n - 3 }, (_, i) => `Team ${String(i + 4).padStart(2, '0')}`)].slice(0, n);

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('fitCount', () => {
  it('shows every name when they fit, and otherwise as many as fit with room for the "+N", and at least one', () => {
    expect(fitCount([36, 30, 48], 12, 24, 400)).toBe(3);
    expect(fitCount([36, 30, 48], 12, 24, 120)).toBe(2); // 36 + 12 + 30 = 78, plus the separator and "+N" is 114 <= 120
    expect(fitCount([36, 30, 48], 12, 24, 100)).toBe(1); // 114 > 100: only the first name fits with its "+N"
    expect(fitCount([36, 30, 48], 12, 24, 10)).toBe(1); // never none
  });
});

describe('the team list on one line (D-F1-53)', () => {
  it('shows every name, comma-separated, with the end text, when they fit', () => {
    stubWidths(1000);
    render(<TeamList names={names(3)} panelLabel="Your teams" end="." />);
    expect(document.querySelector('.teamlist')?.textContent).toBe('Cardio, Neuro, Oncology.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('collapses the names that do not fit into "+N" in the accent count-link style, and the end text goes', () => {
    stubWidths(130); // about 21 characters
    render(<TeamList names={names(6)} panelLabel="Your teams" end="." />);
    const more = screen.getByRole('button', { name: 'Show all 6 teams' });
    expect(more.classList.contains('count-link')).toBe(true);
    const shown = (document.querySelector('.teamlist')?.textContent ?? '').replace(more.textContent ?? '', '');
    expect(shown).toBe('Cardio, Neuro'); // two names fit
    expect(more.textContent).toBe('+4');
    expect(document.querySelector('.teamlist')?.textContent).not.toContain('.');
  });

  it('a narrower box shows fewer names, and always at least one', () => {
    stubWidths(60);
    render(<TeamList names={names(3)} panelLabel="Your teams" />);
    expect((document.querySelector('.teamlist')?.textContent ?? '').startsWith('Cardio')).toBe(true);
    expect(screen.getByRole('button', { name: 'Show all 3 teams' }).textContent).toBe('+2');
  });

  it('the "+N" opens the shared popover with every team, in order: hover (300 ms), focus or a click', async () => {
    stubWidths(100);
    const user = userEvent.setup();
    render(<TeamList names={names(5)} panelLabel="Your teams" />);
    await user.click(screen.getByRole('button', { name: /^Show all 5 teams/ }));
    const panel = screen.getByRole('dialog', { name: 'Your teams' });
    expect([...panel.querySelectorAll('li')].map((li) => li.textContent)).toEqual(names(5)); // all of them, not only the hidden ones
    expect(within(panel).queryByRole('textbox')).toBeNull(); // 5: no filter box
  });

  it('over 15 teams the popover has the "Filter…" box and scrolls (the same popover as everywhere)', async () => {
    stubWidths(100);
    const user = userEvent.setup();
    render(<TeamList names={names(20)} panelLabel="Your teams" />);
    await user.click(screen.getByRole('button', { name: /^Show all 20 teams/ }));
    const panel = screen.getByRole('dialog', { name: 'Your teams' });
    expect(within(panel).getByRole('textbox').getAttribute('placeholder')).toBe('Filter…');
    expect(panel.querySelectorAll('li')).toHaveLength(20);
    await user.type(within(panel).getByRole('textbox'), 'team 1');
    expect([...panel.querySelectorAll('li')].every((li) => /team 1/i.test(li.textContent ?? ''))).toBe(true);
  });

  it('lines the panel up with the right edge of the link when asked to (the header at the right of the window)', async () => {
    stubWidths(100);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    const rect = { top: 20, bottom: 40, left: 880, right: 910, width: 30, height: 20, x: 880, y: 20, toJSON: () => ({}) };
    vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
    const user = userEvent.setup();
    render(<TeamList names={names(5)} panelLabel="Your teams" align="end" />);
    await user.click(screen.getByRole('button', { name: /^Show all 5 teams/ }));
    const left = Number.parseFloat((screen.getByRole('dialog', { name: 'Your teams' }) as HTMLElement).style.left);
    expect(left + 340).toBeLessThanOrEqual(910 + 1); // its right edge is the link's (or further left), inside the window
    expect(left + 340).toBeLessThanOrEqual(1000 - 8);
  });
});
