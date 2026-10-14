import { describe, expect, it } from 'vitest';
import { hashClientSecret } from './routes/internal.js';
import { clientRows, secretEnvName } from './service-clients.js';

const env = {
  CLIENT_SECRET_DELIVERY_WORKER: 'a',
  CLIENT_SECRET_DOCBEAM_API: 'b',
  CLIENT_SECRET_WS_HANDLERS: 'c',
  CLIENT_SECRET_SEED_SCRIPT: 'd',
};

describe('service clients', () => {
  it('names the env variable from the client id', () => {
    expect(secretEnvName('docbeam-api')).toBe('CLIENT_SECRET_DOCBEAM_API');
  });

  it('stores only the SHA-256 of each secret, with the scopes of the TDD table', () => {
    const rows = clientRows(env);
    expect(rows.map((r) => r.clientId)).toEqual(['delivery-worker', 'docbeam-api', 'ws-handlers', 'seed-script']);
    expect(rows[0]).toEqual({ clientId: 'delivery-worker', clientSecretHash: hashClientSecret('a'), scopes: ['documents:ingest'] });
    expect(rows[3]?.scopes).toEqual(['users:read']);
    expect(JSON.stringify(rows)).not.toContain('"a"');
  });

  it('fails when a secret is missing', () => {
    expect(() => clientRows({ ...env, CLIENT_SECRET_WS_HANDLERS: '' })).toThrow(/CLIENT_SECRET_WS_HANDLERS/);
  });
});
