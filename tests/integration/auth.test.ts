import { createRemoteJWKSet, jwtVerify } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUTH_URL,
  TEST_PASSWORD,
  call,
  env,
  refreshCookie,
  registerAndLogin,
  serviceToken,
  uniqueEmail,
} from './helpers.js';

let admin: pg.Client;
beforeAll(async () => {
  admin = new pg.Client({ connectionString: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:5432/auth_db` });
  await admin.connect();
});
afterAll(() => admin.end());

describe('register', () => {
  it('creates an account, never returns the hash', async () => {
    const email = uniqueEmail('reg');
    const res = await call(AUTH_URL, '/auth/register', { json: { email, password: TEST_PASSWORD, name: 'Reg User' } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), email, name: 'Reg User' });
  });

  it('answers 409 REGISTRATION_FAILED for an email in use, whatever the letter case', async () => {
    const email = uniqueEmail('dup');
    await call(AUTH_URL, '/auth/register', { json: { email, password: TEST_PASSWORD, name: 'A' } });
    const again = await call(AUTH_URL, '/auth/register', { json: { email: email.toUpperCase(), password: TEST_PASSWORD, name: 'B' } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REGISTRATION_FAILED');
  });

  it('answers 400 VALIDATION_ERROR for a short or a too long password', async () => {
    const short = await call(AUTH_URL, '/auth/register', { json: { email: uniqueEmail(), password: 'short', name: 'A' } });
    const long = await call(AUTH_URL, '/auth/register', { json: { email: uniqueEmail(), password: 'x'.repeat(73), name: 'A' } });
    expect(short.status).toBe(400);
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('login', () => {
  it('returns a 15-minute RS256 token that checks against the published keys, and a strict cookie', async () => {
    const user = await registerAndLogin(uniqueEmail('login'), 'Login User');
    const keys = createRemoteJWKSet(new URL(`${AUTH_URL}/.well-known/jwks.json`));
    const { payload, protectedHeader } = await jwtVerify(user.token, keys, { issuer: env.JWT_ISSUER, audience: 'docbeam' });
    expect(protectedHeader.alg).toBe('RS256');
    expect(protectedHeader.kid).toBeTruthy();
    expect(payload).toMatchObject({ sub: user.id, email: user.email, name: 'Login User', token_use: 'user' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);

    const login = await call(AUTH_URL, '/auth/login', { json: { email: user.email, password: TEST_PASSWORD } });
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith('docbeam_refresh='));
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(login.body.expiresIn).toBe(900);
  });

  it('gives the same 401 for an unknown email and a wrong password', async () => {
    const user = await registerAndLogin();
    const wrong = await call(AUTH_URL, '/auth/login', { json: { email: user.email, password: 'not-the-password-at-all' } });
    const unknown = await call(AUTH_URL, '/auth/login', { json: { email: uniqueEmail('nobody'), password: TEST_PASSWORD } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.message).toBe('Email or password is incorrect.');
  });

  it('pauses sign-in for 15 minutes after 5 wrong passwords, with the same 401, even for the right password', async () => {
    const user = await registerAndLogin(uniqueEmail('pause'));
    for (let i = 0; i < 5; i++) {
      const res = await call(AUTH_URL, '/auth/login', { json: { email: user.email, password: 'wrong-password-number-' + i } });
      expect(res.status).toBe(401);
    }
    const paused = await call(AUTH_URL, '/auth/login', { json: { email: user.email, password: TEST_PASSWORD } });
    expect(paused.status).toBe(401);
    expect(paused.body.error.message).toBe('Email or password is incorrect.');

    const { rows } = await admin.query('SELECT failed_logins, locked_until FROM users WHERE email = $1', [user.email]);
    const minutes = (new Date(rows[0].locked_until).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    await admin.query('UPDATE users SET locked_until = now() - interval \'1 second\' WHERE email = $1', [user.email]);
    const after = await call(AUTH_URL, '/auth/login', { json: { email: user.email, password: TEST_PASSWORD } });
    expect(after.status).toBe(200);
  });

  it('a right password resets the wrong-password count', async () => {
    const user = await registerAndLogin(uniqueEmail('reset'));
    for (let i = 0; i < 4; i++) await call(AUTH_URL, '/auth/login', { json: { email: user.email, password: 'wrong-password-number-' + i } });
    await call(AUTH_URL, '/auth/login', { json: { email: user.email, password: TEST_PASSWORD } });
    const { rows } = await admin.query('SELECT failed_logins FROM users WHERE email = $1', [user.email]);
    expect(rows[0].failed_logins).toBe(0);
  });
});

describe('refresh and logout', () => {
  it('swaps the token for a new pair, and the old token stops working', async () => {
    const user = await registerAndLogin();
    const first = await call(AUTH_URL, '/auth/refresh', { method: 'POST', cookie: user.cookie });
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();
    const next = refreshCookie(first);
    expect(next).not.toBe(user.cookie);
    const second = await call(AUTH_URL, '/auth/refresh', { method: 'POST', cookie: next });
    expect(second.status).toBe(200);
  });

  it('a used token coming back cancels the whole sign-in, thief and owner alike', async () => {
    const user = await registerAndLogin();
    const first = await call(AUTH_URL, '/auth/refresh', { method: 'POST', cookie: user.cookie });
    const newest = refreshCookie(first);
    const replay = await call(AUTH_URL, '/auth/refresh', { method: 'POST', cookie: user.cookie });
    expect(replay.status).toBe(401);
    const afterReplay = await call(AUTH_URL, '/auth/refresh', { method: 'POST', cookie: newest });
    expect(afterReplay.status).toBe(401);
  });

  it('keeps the original 12-hour end through every refresh', async () => {
    const user = await registerAndLogin();
    await call(AUTH_URL, '/auth/refresh', { method: 'POST', cookie: user.cookie });
    const { rows } = await admin.query(
      `SELECT count(DISTINCT expires_at) AS ends, count(DISTINCT family_id) AS families
         FROM refresh_tokens WHERE user_id = $1`,
      [user.id],
    );
    expect(Number(rows[0].ends)).toBe(1);
    expect(Number(rows[0].families)).toBe(1);
  });

  it('refuses a call with no cookie', async () => {
    const res = await call(AUTH_URL, '/auth/refresh', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('logout cancels the sign-in and clears the cookie', async () => {
    const user = await registerAndLogin();
    const out = await call(AUTH_URL, '/auth/logout', { method: 'POST', cookie: user.cookie });
    expect(out.status).toBe(204);
    const after = await call(AUTH_URL, '/auth/refresh', { method: 'POST', cookie: user.cookie });
    expect(after.status).toBe(401);
  });

  it('stores only a hash of the token', async () => {
    const user = await registerAndLogin();
    const value = user.cookie.split('=')[1] as string;
    const { rows } = await admin.query('SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [user.id]);
    expect(rows[0].token_hash).not.toBe(value);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('service tokens and user lookup', () => {
  it.each([
    ['delivery-worker', 'documents:ingest'],
    ['docbeam-api', 'memberships:read'],
    ['ws-handlers', 'memberships:read'],
    ['seed-script', 'users:read'],
  ])('%s gets a service token for %s', async (clientId, scope) => {
    const token = await serviceToken(clientId, scope);
    const keys = createRemoteJWKSet(new URL(`${AUTH_URL}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, keys, { issuer: env.JWT_ISSUER, audience: 'docbeam' });
    expect(payload).toMatchObject({ sub: clientId, scope, token_use: 'service' });
  });

  it('refuses a wrong secret with 401 and an ungranted scope with 403', async () => {
    const wrong = await call(AUTH_URL, '/auth/token', { json: { clientId: 'docbeam-api', clientSecret: 'nope', scope: 'memberships:read' } });
    expect(wrong.status).toBe(401);
    const secret = env.CLIENT_SECRET_DOCBEAM_API;
    const scope = await call(AUTH_URL, '/auth/token', { json: { clientId: 'docbeam-api', clientSecret: secret, scope: 'documents:ingest' } });
    expect(scope.status).toBe(403);
  });

  it('looks a user up by email with users:read, and 404 for an unknown one', async () => {
    const user = await registerAndLogin();
    const token = await serviceToken('seed-script', 'users:read');
    const found = await call(AUTH_URL, `/internal/users?email=${encodeURIComponent(user.email.toUpperCase())}`, { token });
    expect(found.status).toBe(200);
    expect(found.body).toEqual({ id: user.id });
    const missing = await call(AUTH_URL, `/internal/users?email=${encodeURIComponent(uniqueEmail('ghost'))}`, { token });
    expect(missing.status).toBe(404);
  });

  it('refuses a user token, a missing token and the wrong scope on the lookup', async () => {
    const user = await registerAndLogin();
    const q = `/internal/users?email=${encodeURIComponent(user.email)}`;
    expect((await call(AUTH_URL, q, { token: user.token })).status).toBe(401);
    expect((await call(AUTH_URL, q)).status).toBe(401);
    const wrongScope = await serviceToken('docbeam-api', 'memberships:read');
    expect((await call(AUTH_URL, q, { token: wrongScope })).status).toBe(403);
  });
});
