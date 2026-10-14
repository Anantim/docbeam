import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './db.js';
import { refreshTokens, users } from './schema.js';

/** A sign-in lasts 12 hours from login (ADR-015). */
export const SESSION_HOURS = 12;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface StoredToken {
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

export type Rotation = 'rotate' | 'reuse' | 'expired';

/**
 * What to do with a refresh token that came back. A used or revoked token coming back means
 * two copies exist, so the whole sign-in ends. Checked before expiry so a reused token is always caught.
 */
export function decideRotation(row: StoredToken, now: Date): Rotation {
  if (row.usedAt !== null || row.revokedAt !== null) return 'reuse';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'rotate';
}

export interface Session {
  token: string;
  expiresAt: Date;
}

/** Starts a sign-in: a new family and its first token. */
export async function startSession(db: Db, userId: string, now: Date): Promise<Session> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3_600_000);
  await db.insert(refreshTokens).values({ userId, familyId: randomUUID(), tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

export type RefreshResult =
  | { ok: true; session: Session; user: { id: string; email: string; name: string } }
  | { ok: false };

/** Swaps a valid token for the next one in the same family, with the same end time. */
export async function rotateSession(db: Db, token: string, now: Date): Promise<RefreshResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(token)))
      .for('update');
    if (!row) return { ok: false };

    const decision = decideRotation(row, now);
    if (decision === 'reuse') {
      await revokeFamily(tx, row.familyId, now);
      return { ok: false };
    }
    if (decision === 'expired') return { ok: false };

    const [user] = await tx.select().from(users).where(eq(users.id, row.userId));
    if (!user) return { ok: false };

    await tx.update(refreshTokens).set({ usedAt: now }).where(eq(refreshTokens.id, row.id));
    const next = newToken();
    await tx
      .insert(refreshTokens)
      .values({ userId: row.userId, familyId: row.familyId, tokenHash: hashToken(next), expiresAt: row.expiresAt });
    return { ok: true, session: { token: next, expiresAt: row.expiresAt }, user: { id: user.id, email: user.email, name: user.name } };
  });
}

type Executor = Pick<Db, 'update'>;

export async function revokeFamily(db: Executor, familyId: string, now: Date): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/** Ends the sign-in that owns this token. Unknown tokens are ignored. */
export async function endSession(db: Db, token: string, now: Date): Promise<void> {
  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(token)));
  if (row) await revokeFamily(db, row.familyId, now);
}
