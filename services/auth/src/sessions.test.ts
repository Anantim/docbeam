import { describe, expect, it } from 'vitest';
import { decideRotation, hashToken, newToken } from './sessions.js';

const now = new Date('2026-10-14T10:00:00Z');
const later = new Date('2026-10-14T20:00:00Z');
const earlier = new Date('2026-10-14T09:00:00Z');

describe('refresh rotation decisions', () => {
  it('rotates an unused token before it expires', () => {
    expect(decideRotation({ usedAt: null, revokedAt: null, expiresAt: later }, now)).toBe('rotate');
  });

  it('treats a used token coming back as reuse', () => {
    expect(decideRotation({ usedAt: earlier, revokedAt: null, expiresAt: later }, now)).toBe('reuse');
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
