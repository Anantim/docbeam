// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAUSE_NOTE } from './PauseNote.js';

const session = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn() }));
vi.mock('../auth/session.js', () => {
  class AuthError extends Error {}
  return { AuthError, login: session.login, logout: session.logout };
});

const { AuthCard } = await import('./AuthCard.js');
const { SessionDialog } = await import('./SessionDialog.js');
const { AuthError } = await import('../auth/session.js');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

async function failToSignIn(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Work email'), 'someone@example.com');
  await user.type(screen.getByLabelText('Password'), 'not-the-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('the sign-in page (D-F1-17)', () => {
  it('has the tagline, the subtitle, one quiet line about accounts, and no way to register', () => {
    render(<AuthCard />);
    expect(screen.getByRole('heading', { name: 'One upload, every binder that needs it.' })).toBeTruthy();
    expect(screen.getByText('Clinical trial document distribution for study teams')).toBeTruthy();
    expect(screen.getByText('Accounts are set up by your study administrator.')).toBeTruthy();
    expect(screen.queryByText(/create an account|create account|full name|register/i)).toBeNull();
    expect(screen.queryByLabelText('Full name')).toBeNull();
  });
});

describe('show password on both screens (D-F1-61)', () => {
  it('the sign-in page: hidden at first, shown by the eye, hidden again after the attempt', async () => {
    session.login.mockRejectedValue(new Error('x'));
    const user = userEvent.setup();
    render(<AuthCard />);
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    await user.type(pw, 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw.type).toBe('text');
    await user.type(screen.getByLabelText('Work email'), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(pw.type).toBe('password');
  });

  it('the "Sign in again" dialog: hidden when it opens, shown by the eye, hidden again after the attempt', async () => {
    session.login.mockRejectedValue(new Error('x'));
    const user = userEvent.setup();
    render(<SessionDialog email="priya.shah@example.com" onSignedIn={() => undefined} />);
    const pw = screen.getByLabelText('Password', { selector: 'input' }) as HTMLInputElement;
    expect(pw.type).toBe('password');
    await user.type(pw, 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw.type).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(pw.type).toBe('password');
  });
});

describe('the sign-in pause note (D-M3-13)', () => {
  it('is not shown before a failed attempt', () => {
    render(<AuthCard />);
    expect(screen.queryByTestId('pause-note')).toBeNull();
  });

  it.each([
    ['a wrong password', 'The email or password is not right.'],
    ['an unknown email', 'The email or password is not right.'],
    ['a paused account', 'The email or password is not right.'],
    ['the gateway throttle', 'Too many attempts. Wait a moment and try again.'],
  ])('shows the same fixed line under %s', async (_label, message) => {
    session.login.mockRejectedValue(new AuthError(message));
    render(<AuthCard />);
    await failToSignIn();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(message);
    expect(screen.getByTestId('pause-note').textContent).toBe(PAUSE_NOTE);
  });

  it('says exactly what the person asked for', () => {
    expect(PAUSE_NOTE).toBe('After 5 wrong passwords in a row, sign-in pauses for 15 minutes. Wait, then try again.');
  });

  it('is shown in the dialog that opens after 12 hours, after a failed attempt', async () => {
    session.login.mockRejectedValue(new AuthError('The email or password is not right.'));
    const user = userEvent.setup();
    render(<SessionDialog email="priya.shah@example.com" onSignedIn={() => undefined} />);
    expect(screen.queryByTestId('pause-note')).toBeNull();
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await screen.findByRole('alert');
    expect(screen.getByTestId('pause-note').textContent).toBe(PAUSE_NOTE);
  });
});
