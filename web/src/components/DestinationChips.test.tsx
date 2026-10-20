// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DestinationChips } from './DestinationChips.js';

afterEach(cleanup);

const PATHS = [
  'Cardio / CARDIO-301 Regulatory / Protocol amendments',
  'Cardio / CARDIO-301 Regulatory / Consent forms',
  'Cardio / CARDIO-302 Safety / Reports',
  'Oncology / ONC-100 / Imaging',
  'Neuro / NEURO-9 / Site approvals',
];

// How a popover opens, stays and closes is in Popover.test.tsx; this file is about what the chips hold.
describe('DestinationChips', () => {
  it('shows two chips, each titled with its own full path only', () => {
    render(<DestinationChips paths={PATHS} />);
    const chips = screen.getAllByTitle(/Cardio \/ CARDIO-301/);
    expect(chips).toHaveLength(2);
    expect(chips[0]?.getAttribute('title')).toBe(PATHS[0]);
    expect(chips[1]?.getAttribute('title')).toBe(PATHS[1]);
    expect(chips[0]?.textContent).toBe('Protocol amendments');
  });

  it('has no +N button when everything fits', () => {
    render(<DestinationChips paths={PATHS.slice(0, 2)} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the hidden count for a screen reader, in the one count-link look', () => {
    render(<DestinationChips paths={PATHS} />);
    const more = screen.getByRole('button', { name: 'Show 3 more folders' });
    expect(more.textContent).toBe('+3');
    expect(more.classList.contains('count-link')).toBe(true);
    cleanup();
    render(<DestinationChips paths={PATHS.slice(0, 3)} />);
    expect(screen.getByRole('button', { name: 'Show 1 more folder' })).toBeTruthy();
  });

  it('lists only the hidden folders, each with its full path, when the link is clicked (D-F1-33)', async () => {
    const user = userEvent.setup();
    render(<DestinationChips paths={PATHS} />);
    await user.click(screen.getByRole('button', { name: 'Show 3 more folders' }));
    const panel = screen.getByRole('dialog', { name: '3 more folders' });
    expect([...panel.querySelectorAll('li')].map((e) => e.textContent)).toEqual(PATHS.slice(2));
    expect([...panel.querySelectorAll('li')].map((e) => e.getAttribute('title'))).toEqual(PATHS.slice(2)); // and as the tooltip
    // The two visible folders are not repeated.
    expect(panel.textContent).not.toContain('Protocol amendments');
    expect(panel.textContent).not.toContain('Consent forms');
  });

  it('gives each chip its full path as the tooltip and the accessible name, with the folder name as its text', () => {
    render(<DestinationChips paths={PATHS} />);
    const chip = screen.getByRole('img', { name: PATHS[0] as string });
    expect(chip.getAttribute('title')).toBe(PATHS[0]);
    expect(chip.textContent).toBe(PATHS[0]?.split(' / ').at(-1));
  });
});
