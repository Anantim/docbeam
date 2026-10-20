import { describe, expect, it } from 'vitest';
import { decideRotation, hashToken, newToken } from './sessions.js';

const now = new Date('2026-10-14T10:00:00Z');
const later = new Date('2026-10-14T20:00:00Z');
const earlier = new Date('2026-10-14T09:00:00Z');

describe('refresh rotation decisions', () => {
  it('rotates an unused token before it expires', () => {
    expect(decideRotation({ usedAt: null, revokedAt: null, expiresAt: later }, now)).toBe('rotate');
  });

  it('treats a used token coming back after more than 30 seconds as reuse', () => {
    expect(decideRotation({ usedAt: earlier, revokedAt: null, expiresAt: later }, now)).toBe('reuse');
    expect(decideRotation({ usedAt: new Date(now.getTime() - 31_000), revokedAt: null, expiresAt: later }, now)).toBe('reuse');
  });

  it('carries on (grace) for a used token that comes back within 30 seconds of its swap, a lost answer and not a thief', () => {
    expect(decideRotation({ usedAt: new Date(now.getTime() - 1_000), revokedAt: null, expiresAt: later }, now)).toBe('grace');
    expect(decideRotation({ usedAt: new Date(now.getTime() - 30_000), revokedAt: null, expiresAt: later }, now)).toBe('grace'); // the 30th second still counts
  });

  it('gives no grace to a revoked token, or once the 12 hours are over', () => {
    const justNow = new Date(now.getTime() - 1_000);
    expect(decideRotation({ usedAt: justNow, revokedAt: justNow, expiresAt: later }, now)).toBe('reuse');
    expect(decideRotation({ usedAt: justNow, revokedAt: null, expiresAt: earlier }, now)).toBe('reuse');
  });

  it('treats a revoked token as reuse', () => {
    expect(decideRotation({ usedAt: null, revokedAt: earlier, expiresAt: later }, now)).toBe('reuse');
  });

  it('catches reuse even after the 12 hours', () => {
    expect(decideRotation({ usedAt: earlier, revokedAt: null, expiresAt: earlier }, now)).toBe('reuse');
  });

  it('refuses an unused token after the 12 hours', () => {
    expect(decideRotation({ usedAt: null, revokedAt: null, expiresAt: earlier }, now)).toBe('expired');
  });
});

describe('token values', () => {
  it('are random and stored only as SHA-256', () => {
    const a = newToken();
    expect(a).not.toBe(newToken());
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });
});
