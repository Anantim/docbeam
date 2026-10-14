import { describe, expect, it, vi } from 'vitest';
import { createSecretReader } from './secrets.js';

describe('secret reader', () => {
  it('uses the plain value when it is set (local .env)', async () => {
    const fetcher = vi.fn();
    const reader = createSecretReader({ CLIENT_SECRET: 'local', CLIENT_SECRET_ARN: 'arn:x' }, fetcher);
    expect(await reader.read('CLIENT_SECRET')).toBe('local');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads the ARN once and keeps the value', async () => {
    const fetcher = vi.fn(async () => '{"password":"p4ss","username":"docbeam_app"}');
    const reader = createSecretReader({ DB_SECRET_ARN: 'arn:db' }, fetcher);
    expect(await reader.readField('DB_SECRET', 'password')).toBe('p4ss');
    expect(await reader.readField('DB_SECRET', 'username')).toBe('docbeam_app');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('arn:db');
  });

  it('fails when neither name is set', async () => {
    const reader = createSecretReader({}, vi.fn());
    await expect(reader.read('MISSING')).rejects.toThrow('MISSING');
  });

  it('does not cache a failed read', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('throttled')).mockResolvedValueOnce('ok');
    const reader = createSecretReader({ S_ARN: 'arn:s' }, fetcher);
    await expect(reader.read('S')).rejects.toThrow('throttled');
    await new Promise((r) => setTimeout(r, 0));
    expect(await reader.read('S')).toBe('ok');
  });

  it('returns a plain local value as the field itself', async () => {
    const fetcher = vi.fn();
    const reader = createSecretReader({ CLIENT_SECRET_DELIVERY_WORKER: 'plain-secret' }, fetcher);
    expect(await reader.readField('CLIENT_SECRET_DELIVERY_WORKER', 'client_secret')).toBe('plain-secret');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails when a JSON field is missing', async () => {
    const reader = createSecretReader({ S_ARN: 'arn:s' }, async () => '{"a":"1"}');
    await expect(reader.readField('S', 'b')).rejects.toThrow('no string field b');
  });
});
