import { ApiError } from '@docbeam/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { afterRightPassword, afterWrongPassword, isPaused } from '../login-attempts.js';
import { DUMMY_HASH, hashPassword, passwordLengthOk, verifyPassword } from '../passwords.js';
import { users } from '../schema.js';
import { endSession, rotateSession, startSession, type Session } from '../sessions.js';
import { ACCESS_TOKEN_SECONDS, type TokenIssuer } from '../tokens.js';

/** The refresh cookie is sent only to the auth routes, under the public /api prefix (D-G5). */
export const REFRESH_COOKIE = 'docbeam_refresh';
const COOKIE_PATH = '/api/auth';

const registerBody = z.object({
  email: z.string().trim().min(3).max(254).email(),
  password: z.string(),
  name: z.string().trim().min(1).max(200),
});

const loginBody = z.object({ email: z.string().trim().min(1).max(254), password: z.string().max(1024) });

function badLogin(): ApiError {
  return new ApiError(401, 'UNAUTHORIZED', 'Email or password is incorrect.');
}

function setRefreshCookie(reply: FastifyReply, session: Session, now: Date): void {
  const maxAge = Math.max(0, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000));
  reply.setCookie(REFRESH_COOKIE, session.token, {
    path: COOKIE_PATH,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, secure: true, sameSite: 'strict' });
}

export function registerAccountRoutes(app: FastifyInstance, db: Db, issuer: TokenIssuer): void {
  app.post('/auth/register', async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success || !passwordLengthOk(parsed.data.password)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Enter a valid email, a name and a password of 12 to 72 bytes.');
    }
    const { email, password, name } = parsed.data;
    const passwordHash = await hashPassword(password);
    // The unique index decides, so two parallel registrations cannot both win.
    const [created] = await db
      .insert(users)
      .values({ email, passwordHash, name })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, email: users.email, name: users.name });
    if (!created) throw new ApiError(409, 'REGISTRATION_FAILED', 'This account could not be created.');
    return reply.status(201).send(created);
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) throw badLogin();
    const { email, password } = parsed.data;
    const now = new Date();

    const user = await db.transaction(async (tx) => {
      // The row lock makes concurrent wrong passwords count one after the other.
      const [row] = await tx.select().from(users).where(eq(users.email, email)).for('update');
      if (!row) {
        await verifyPassword(password, DUMMY_HASH);
        return null;
      }
      const matches = await verifyPassword(password, row.passwordHash);
      if (isPaused(row, now)) return null;
      const state = matches ? afterRightPassword() : afterWrongPassword(row, now);
      await tx.update(users).set(state).where(eq(users.id, row.id));
      return matches ? row : null;
    });
    if (!user) throw badLogin();

    const session = await startSession(db, user.id, now);
    setRefreshCookie(reply, session, now);
    request.log.info({ userId: user.id }, 'sign-in');
    const accessToken = await issuer.user(user);
    return reply.header('Cache-Control', 'no-store').send({ accessToken, expiresIn: ACCESS_TOKEN_SECONDS });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    const now = new Date();
    const result = await rotateSession(db, token, now);
    if (!result.ok) {
      clearRefreshCookie(reply);
      throw new ApiError(401, 'UNAUTHORIZED', 'Sign in again.');
    }
    setRefreshCookie(reply, result.session, now);
    const accessToken = await issuer.user(result.user);
    return reply.header('Cache-Control', 'no-store').send({ accessToken, expiresIn: ACCESS_TOKEN_SECONDS });
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token) await endSession(db, token, new Date());
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });
}
