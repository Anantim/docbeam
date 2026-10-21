// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { tooltipOf } from '../testing/tooltip.js';
import { PasswordField } from './PasswordField.js';

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState('');
  const [attempts, setAttempts] = useState(0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setAttempts((n) => n + 1);
      }}
    >
      <label htmlFor="pw">Password</label>
      <PasswordField id="pw" value={value} onChange={setValue} resetKey={attempts} />
      <button type="submit">Sign in</button>
    </form>
  );
}

const field = () => document.getElementById('pw') as HTMLInputElement;

describe('the password field with its eye button (D-F1-61)', () => {
  it('is hidden at first, with a "Show password" button that is not pressed', () => {
    render(<Harness />);
    expect(field().type).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(tooltipOf(toggle)).toBe('Show password');
  });

  it('shows the password, switches to "Hide password" and the eye-off icon, and hides it again', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), 'correct horse');
    const eye = screen.getByRole('button', { name: 'Show password' }).innerHTML;
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field().type).toBe('text');
    expect(field().value).toBe('correct horse');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    expect(hide.innerHTML).not.toBe(eye); // eye-off
    await user.click(hide);
    expect(field().type).toBe('password');
    expect(screen.getByRole('button', { name: 'Show password' }).innerHTML).toBe(eye);
  });

  it('comes right after the field in the Tab order, and a keyboard press keeps the focus on the button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    field().focus();
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(document.activeElement).toBe(toggle);
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide password' }));
    expect(field().type).toBe('text');
  });

  it('a click does not take the focus or the caret out of the field', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: 'abcdef' } });
    field().focus();
    field().setSelectionRange(2, 4);
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(fireEvent.mouseDown(toggle)).toBe(false); // the press is cancelled, so the focus stays in the field
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([2, 4]);
  });

  it('goes back to hidden after a sign-in attempt', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), 'secret');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field().type).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(field().type).toBe('password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy();
    expect(field().value).toBe('secret'); // the text is kept, only hidden
  });

  it('allows pasting, and the browser\'s own reveal button is hidden by the stylesheet', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    field().focus();
    await user.paste('pasted-password');
    expect(field().value).toBe('pasted-password');
    const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');
    expect(css).toMatch(/input::-ms-reveal, input::-ms-clear \{ display: none; \}/);
  });
});
