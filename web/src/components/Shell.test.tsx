// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Every character is 6 px; the teams box is 220 px wide, as in the header.
function stubWidths(): void {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return (this.textContent ?? '').length * 6;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('teamlist') ? 220 : 0;
  });
}

const claims = { sub: 's', email: 'a@example.com', name: 'Anantim Patil', exp: 9_999_999_999 };
const teams = (n: number): string[] => Array.from({ length: n }, (_, i) => ['Cardio', 'Neuro', 'Oncology'][i] ?? `Team ${String(i + 1).padStart(2, '0')}`);
const show = (n: number, name = claims.name) =>
  render(
    <Shell claims={{ ...claims, name }} teams={teams(n)} view="status" onView={() => undefined}>
      <p>page</p>
    </Shell>,
  );

describe('the teams line in the header (D-F1-53)', () => {
  it('shows one team, and three teams, as plain text on one line', () => {
    stubWidths();
    show(1);
    expect(document.querySelector('.who .tm')?.textContent).toBe('Cardio');
    cleanup();
    show(3);
    expect(document.querySelector('.who .tm')?.textContent).toBe('Cardio, Neuro, Oncology');
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  });

  it('with 20 teams, the names that fit are shown and the rest are "+N"; the popover lists all 20 with a "Filter…" box, lined up to the right', async () => {
    stubWidths();
    const user = userEvent.setup();
    show(20);
    const more = screen.getByRole('button', { name: 'Show all 20 teams' });
    const shown = (document.querySelector('.who .tm')?.textContent ?? '').replace(more.textContent ?? '', '');
    expect(shown.length).toBeLessThanOrEqual(Math.floor(220 / 6));
    expect(shown.startsWith('Cardio, Neuro')).toBe(true);
    expect(Number(more.textContent?.slice(1)) + shown.split(', ').length).toBe(20);
    await user.click(more);
    const panel = screen.getByRole('dialog', { name: 'Your teams' });
    expect(panel.querySelectorAll('li')).toHaveLength(20);
    expect(panel.querySelector('input')?.getAttribute('placeholder')).toBe('Filter…');
  });

  it('the name ends in an ellipsis with the full name in a tooltip, and the teams line is held to about 220 px', () => {
    stubWidths();
    show(1, 'A very long name indeed, Doctor of Many Things and Professor of Regulatory Affairs');
    const name = document.querySelector('.who .nm') as HTMLElement;
    expect(name.classList.contains('ellipsis')).toBe(true);
    expect(name.closest('.tip-wrap')).not.toBeNull();
    const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');
    expect(css).toMatch(/\.who \.tm \{[^}]*max-width: 220px/);
    expect(css).toMatch(/\.who \.nm \{ max-width: 220px; \}/);
    expect(css).toMatch(/\.teamlist \{[^}]*white-space: nowrap/);
  });
});

describe('page spacing (D-F1-54)', () => {
  const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');

  it('names the two gaps once, and Status and Distribute both use them', () => {
    expect(css).toMatch(/--gap-section: var\(--s-4\)/); // 16 px
    expect(css).toMatch(/--gap-controls: var\(--s-3\)/); // 12 px
    expect(css).toMatch(/\.page \{[^}]*gap: var\(--gap-section\); padding: var\(--gap-section\) var\(--s-6\) var\(--s-6\)/);
    expect(css).toMatch(/\.page > \.filterbar \+ \.status-layout \{ margin-top: calc\(var\(--gap-controls\) - var\(--gap-section\)\)/);
  });
});
