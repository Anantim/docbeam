import bcrypt from 'bcryptjs';

/** bcrypt cost from the TDD (Step 1.1). */
export const BCRYPT_COST = 12;
const MIN_BYTES = 12;
/** bcrypt reads at most 72 bytes (D-G17). */
const MAX_BYTES = 72;

export function passwordLengthOk(password: string): boolean {
  const bytes = Buffer.byteLength(password, 'utf8');
  return bytes >= MIN_BYTES && bytes <= MAX_BYTES;
}

export function hashPassword(password: string, cost = BCRYPT_COST): Promise<string> {
  return bcrypt.hash(password, cost);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * A hash of a random value nobody knows. Login compares against it when the email is unknown,
 * so an unknown email takes as long as a wrong password.
 */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-' + Math.random(), BCRYPT_COST);
