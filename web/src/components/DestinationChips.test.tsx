// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
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

  it('names the hidden count for a screen reader', () => {
    render(<DestinationChips paths={PATHS} />);
    expect(screen.getByRole('button', { name: 'Show 3 more folders' }).textContent).toBe('+3');
    cleanup();
    render(<DestinationChips paths={PATHS.slice(0, 3)} />);
    expect(screen.getByRole('button', { name: 'Show 1 more folder' })).toBeTruthy();
  });

  it('lists only the hidden folders, each with its full path, when the button is clicked (D-F1-33)', async () => {
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

  it('opens on hover and closes when the pointer leaves unless a click kept it open', async () => {
    const user = userEvent.setup();
    render(<DestinationChips paths={PATHS} />);
    const button = screen.getByRole('button', { name: 'Show 3 more folders' });
    await user.hover(button);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.unhover(button);
    await new Promise((r) => setTimeout(r, 450));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(button);
    await user.unhover(button);
    await new Promise((r) => setTimeout(r, 450));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Esc and gives the focus back to the button', async () => {
    const user = userEvent.setup();
    render(<DestinationChips paths={PATHS} />);
    const button = screen.getByRole('button', { name: 'Show 3 more folders' });
    await user.click(button);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('stays open while the pointer moves from the chip into the panel, and while the list scrolls inside it', async () => {
    const user = userEvent.setup();
    render(<DestinationChips paths={PATHS} />);
    const button = screen.getByRole('button', { name: 'Show 3 more folders' });
    await user.hover(button);
    const panel = screen.getByRole('dialog', { name: '3 more folders' });
    await user.unhover(button);
    await user.hover(panel); // arrives within the close delay
    await new Promise((r) => setTimeout(r, 450));
    expect(screen.queryByRole('dialog')).not.toBeNull();

    // Scrolling the list inside the panel does not close it.
    const list = panel.querySelector('.popover-list') as HTMLElement;
    act(() => {
      list.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    // The page scrolling under it does.
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a click pins it: the pointer can leave, and only Esc, a click outside or another click closes it', async () => {
    const user = userEvent.setup();
    render(<DestinationChips paths={PATHS} />);
    const button = screen.getByRole('button', { name: 'Show 3 more folders' });
    await user.click(button);
    await user.unhover(button);
    await new Promise((r) => setTimeout(r, 450));
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('closes on a click outside', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <DestinationChips paths={PATHS} />
        <button type="button">elsewhere</button>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Show 3 more folders' }));
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when Tab moves the focus away, and can be opened from the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <DestinationChips paths={PATHS} />
        <button type="button">next</button>
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Show 3 more folders' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.tab(); // into the scrolling list
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await user.tab(); // out of the popover
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

