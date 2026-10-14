/** Five wrong passwords in a row pause sign-in for 15 minutes (ADR-015). */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export interface LoginState {
  failedLogins: number;
  lockedUntil: Date | null;
}

export function isPaused(state: LoginState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/** The state after one wrong password. The fifth in a row sets the pause and resets the count. */
export function afterWrongPassword(state: LoginState, now: Date): LoginState {
  const failedLogins = state.failedLogins + 1;
  if (failedLogins >= MAX_FAILED_LOGINS) {
    return { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) };
  }
  return { failedLogins, lockedUntil: state.lockedUntil };
}

/** The state after a right password. */
export function afterRightPassword(): LoginState {
  return { failedLogins: 0, lockedUntil: null };
}
