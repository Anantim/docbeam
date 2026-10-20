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

/** A token that was just swapped may come back once more: the answer to the swap can be lost on the network (D-F1-19). */
export const REUSE_GRACE_SECONDS = 30;

export type Rotation = 'rotate' | 'grace' | 'reuse' | 'expired';

/**
 * What to do with a refresh token that came back. A used or revoked token coming back means
 * two copies exist, so the whole sign-in ends, except for a used token that comes back within 30 seconds of its swap
 * and before the 12 hours are over: that is a lost answer, not a thief, and gets the sign-in carried on ("grace").
 * A revoked token is always reuse. Checked before expiry so a reused token is always caught.
 */
export function decideRotation(row: StoredToken, now: Date): Rotation {
  if (row.revokedAt !== null) return 'reuse';
  if (row.usedAt !== null) {
    const withinGrace = now.getTime() - row.usedAt.getTime() <= REUSE_GRACE_SECONDS * 1000;
    return withinGrace && row.expiresAt.getTime() > now.getTime() ? 'grace' : 'reuse';
  }
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

/** Swaps a valid token (or one swapped less than 30 seconds ago) for the next one in the same family, with the same end time. */
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

    // A token that comes back in its grace window keeps its first `usedAt`, so the window is 30 seconds from the swap and
    // does not move. Only the hash of a token is stored, so the token sent the first time cannot be sent again: the
    // caller gets a new one in the same family, with the same end time.
    if (decision === 'rotate') await tx.update(refreshTokens).set({ usedAt: now }).where(eq(refreshTokens.id, row.id));
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
