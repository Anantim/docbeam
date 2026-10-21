// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover.js';

const items = (n: number): string[] => Array.from({ length: n }, (_, i) => `Cardio / Binder ${i % 3} / Folder ${String(i + 1).padStart(2, '0')}`);

function Harness({ list, extra = false }: { list: string[]; extra?: boolean }) {
  return (
    <div>
      <Popover label="+3" ariaLabel="Show 3 more" panelLabel="3 more" items={list} />
      {extra && <button type="button">elsewhere</button>}
    </div>
  );
}

const link = () => screen.getByRole('button', { name: 'Show 3 more' });
const panel = () => screen.queryByRole('dialog');
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe('the count link and its popover (D-F1-42)', () => {
  it('opens on hover only after 300 ms, and not at all if the pointer leaves sooner', async () => {
    const user = setup();
    render(<Harness list={items(5)} />);
    await user.hover(link());
    await wait(250);
    expect(panel()).toBeNull();
    await user.unhover(link());
    await wait(400);
    expect(panel()).toBeNull(); // left before 300 ms: it never opens

    await user.hover(link());
    await wait(320);
    expect(panel()).not.toBeNull();
  });

  it('closes 200 ms after the pointer leaves both the link and the panel, and stays open while it is on either', async () => {
    const user = setup();
    render(<Harness list={items(5)} />);
    await user.hover(link());
    await wait(320);
    await user.unhover(link());
    await wait(100);
    await user.hover(panel() as HTMLElement); // into the panel within 200 ms: the list can be scrolled
    await wait(500);
    expect(panel()).not.toBeNull();
    await user.unhover(panel() as HTMLElement);
    await wait(150);
    expect(panel()).not.toBeNull();
    await wait(100);
    expect(panel()).toBeNull();
  });

  it('opens on keyboard focus, and Enter pins it: the pointer can leave and it stays', async () => {
    const user = setup();
    render(<Harness list={items(5)} />);
    await user.tab();
    expect(document.activeElement).toBe(link());
    expect(panel()).not.toBeNull(); // on focus
    await user.keyboard('{Enter}');
    await user.hover(link());
    await user.unhover(link());
    await wait(600);
    expect(panel()).not.toBeNull(); // pinned
    expect(link().getAttribute('aria-expanded')).toBe('true');
  });

  it('a click pins it; another click on the link, Esc (the focus goes back to the link) or a click outside closes it', async () => {
    const user = setup();
    render(<Harness list={items(5)} extra />);
    await user.click(link());
    await user.unhover(link());
    await wait(600);
    expect(panel()).not.toBeNull();
    await user.click(link());
    expect(panel()).toBeNull();

    await user.click(link());
    await user.keyboard('{Escape}');
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(link());

    await user.click(link());
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(panel()).toBeNull();
  });

  it('is drawn on the page body, not inside the card that holds the link, so nothing clips it', async () => {
    const user = setup();
    const { container } = render(<Harness list={items(5)} />);
    await user.click(link());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(panel()?.parentElement).toBe(document.getElementById('overlay-root')); // the one shared overlay, on the body (D-F1-47)
    expect(document.getElementById('overlay-root')?.parentElement).toBe(document.body);
  });

  it('lists full paths, and shows no filter box for 15 or fewer', async () => {
    const user = setup();
    const list = items(15);
    render(<Harness list={list} />);
    await user.click(link());
    expect(within(panel() as HTMLElement).queryByRole('textbox')).toBeNull();
    expect([...(panel() as HTMLElement).querySelectorAll('li')].map((li) => li.textContent)).toEqual(list);
  });

  it('shows a Filter… box above 15 items, with focus in it at once when opened by a click', async () => {
    const user = setup();
    render(<Harness list={items(16)} />);
    await user.click(link());
    const box = within(panel() as HTMLElement).getByRole('textbox');
    expect(box.getAttribute('placeholder')).toBe('Filter…');
    expect(document.activeElement).toBe(box);
  });

  it('filters in any case, anywhere in the path; says "No matches"; Esc empties the box first and closes second', async () => {
    const user = setup();
    render(<Harness list={items(40)} />);
    await user.click(link());
    const box = within(panel() as HTMLElement).getByRole('textbox');
    await user.type(box, 'binder 2');
    const shown = [...(panel() as HTMLElement).querySelectorAll('li')].map((li) => li.textContent as string);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((t) => t.includes('Binder 2'))).toBe(true);
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(within(panel() as HTMLElement).getByText('No matches')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect((box as HTMLInputElement).value).toBe(''); // the first Esc empties the box
    expect(panel()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(panel()).toBeNull(); // the second closes
  });

  it('"No matches" has a "Clear filter" link that empties the box and puts the focus back in it (D-F1-45)', async () => {
    const user = setup();
    render(<Harness list={items(40)} />);
    await user.click(link());
    const box = within(panel() as HTMLElement).getByRole('textbox') as HTMLInputElement;
    await user.type(box, 'zzz');
    const none = (panel() as HTMLElement).querySelector('.no-matches') as HTMLElement;
    expect(none.textContent).toBe('No matchesClear filter');
    await user.click(within(none).getByRole('button', { name: 'Clear filter' }));
    expect(box.value).toBe('');
    expect(document.activeElement).toBe(box);
    expect((panel() as HTMLElement).querySelectorAll('li').length).toBe(40);
  });

  it('focusing or clicking the box pins a panel that was open only by hover', async () => {
    const user = setup();
    render(<Harness list={items(40)} />);
    await user.hover(link());
    await wait(320);
    expect(panel()).not.toBeNull();
    await user.click(within(panel() as HTMLElement).getByRole('textbox'));
    await user.unhover(panel() as HTMLElement);
    await wait(600);
    expect(panel()).not.toBeNull(); // pinned until Esc or a click outside
  });

  it('closes when its link scrolls out of view', async () => {
    const callbacks: Array<(entries: Array<{ intersectionRatio: number }>) => void> = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: Array<{ intersectionRatio: number }>) => void) {
          callbacks.push(cb);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    try {
      const user = setup();
      render(<Harness list={items(5)} />);
      await user.click(link());
      expect(panel()).not.toBeNull();
      act(() => callbacks.forEach((cb) => cb([{ intersectionRatio: 0 }])));
      expect(panel()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is placed above the link when there is no room below, and inside the window sideways', async () => {
    const user = setup();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(500);
    const rect = (top: number, left: number) => ({ top, bottom: top + 20, left, right: left + 30, width: 30, height: 20, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect(360, 480) as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(300);
    render(<Harness list={items(40)} />);
    await user.click(link());
    const style = (panel() as HTMLElement).style;
    expect(Number.parseFloat(style.top)).toBeLessThan(360); // above the link at 360: below has 12 px only
    expect(Number.parseFloat(style.left)).toBeLessThanOrEqual(500 - 340 + 1); // pushed left to stay inside
    expect(Number.parseFloat(style.left)).toBeGreaterThanOrEqual(8);
    vi.restoreAllMocks();
  });
});
