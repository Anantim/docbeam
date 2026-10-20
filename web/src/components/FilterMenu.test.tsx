// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterMenu } from './FilterMenu.js';
import { FILTER_AFTER } from './ListFilter.js';

afterEach(cleanup);

const people = (n: number) => [{ value: 'me', label: 'Me' }, ...Array.from({ length: n - 1 }, (_, i) => ({ value: `u${i}`, label: `Person ${String.fromCharCode(65 + (i % 26))}${i}` }))];

const menu = (choices: ReturnType<typeof people>, filterAfter?: number, onChange = vi.fn()) =>
  render(<FilterMenu label="Sender" value={undefined} valueLabel="" anyLabel="Anyone" choices={choices} onChange={onChange} filterAfter={filterAfter} />);

describe('the Sender menu Filter… box (D-F1-41)', () => {
  it('has no box for 10 people or fewer, and one above that', async () => {
    const user = userEvent.setup();
    menu(people(10), FILTER_AFTER.people);
    await user.click(screen.getByRole('button', { name: 'Sender' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    cleanup();
    menu(people(11), FILTER_AFTER.people);
    await user.click(screen.getByRole('button', { name: 'Sender' }));
    expect(screen.getByRole('textbox', { name: 'Filter sender' }).getAttribute('placeholder')).toBe('Filter…');
    expect(document.activeElement).toBe(screen.getByRole('textbox')); // the focus is in the box, and the arrows go on into the list
  });

  it('never shows a box when the menu does not ask for one (Status, Sent, Team)', async () => {
    const user = userEvent.setup();
    menu(people(40)); // no filterAfter: the other menus
    await user.click(screen.getByRole('button', { name: 'Sender' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('narrows the people in any case, keeps "Anyone", says "No matches", chooses one, and Esc empties then closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    menu(people(15), FILTER_AFTER.people, onChange);
    await user.click(screen.getByRole('button', { name: 'Sender' }));
    const box = screen.getByRole('textbox') as HTMLInputElement;
    await user.type(box, 'PERSON B');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitemradio').map((i) => i.textContent);
    expect(items[0]).toBe('Anyone');
    expect(items.slice(1)).toEqual(['Person B1']);
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(within(screen.getByRole('menu')).getAllByRole('menuitemradio')).toHaveLength(1); // only "Anyone"
    await user.keyboard('{Escape}');
    expect(box.value).toBe('');
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.type(box, 'person c');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('u2');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('"No matches" has a "Clear filter" link that empties the box and puts the focus back in it (D-F1-45)', async () => {
    const user = userEvent.setup();
    menu(people(15), FILTER_AFTER.people);
    await user.click(screen.getByRole('button', { name: 'Sender' }));
    const box = screen.getByRole('textbox') as HTMLInputElement;
    await user.type(box, 'zzz');
    await user.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Clear filter' }));
    expect(box.value).toBe('');
    expect(document.activeElement).toBe(box);
    expect(within(screen.getByRole('menu')).getAllByRole('menuitemradio')).toHaveLength(16);
  });

  it('Esc with an empty box closes the menu', async () => {
    const user = userEvent.setup();
    menu(people(15), FILTER_AFTER.people);
    await user.click(screen.getByRole('button', { name: 'Sender' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
