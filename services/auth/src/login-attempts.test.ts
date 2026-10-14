import { describe, expect, it } from 'vitest';
import { afterRightPassword, afterWrongPassword, isPaused, LOCK_MINUTES, type LoginState } from './login-attempts.js';

const now = new Date('2026-10-14T10:00:00Z');
const fresh: LoginState = { failedLogins: 0, lockedUntil: null };

describe('wrong password counting', () => {
  it('counts wrong passwords without pausing before the fifth', () => {
    let state = fresh;
    for (let i = 1; i <= 4; i++) {
      state = afterWrongPassword(state, now);
      expect(state.failedLogins).toBe(i);
      expect(isPaused(state, now)).toBe(false);
    }
  });

  it('pauses for 15 minutes on the fifth and resets the count', () => {
    let state = fresh;
    for (let i = 0; i < 5; i++) state = afterWrongPassword(state, now);
    expect(state.failedLogins).toBe(0);
    expect(state.lockedUntil?.getTime()).toBe(now.getTime() + LOCK_MINUTES * 60_000);
    expect(isPaused(state, now)).toBe(true);
  });

  it('ends the pause after 15 minutes', () => {
    let state = fresh;
    for (let i = 0; i < 5; i++) state = afterWrongPassword(state, now);
    const later = new Date(now.getTime() + LOCK_MINUTES * 60_000);
    expect(isPaused(state, later)).toBe(false);
  });

  it('a right password resets the count', () => {
    const state = afterWrongPassword(afterWrongPassword(fresh, now), now);
    expect(state.failedLogins).toBe(2);
    expect(afterRightPassword()).toEqual(fresh);
  });
});
