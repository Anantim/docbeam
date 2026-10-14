import { hashClientSecret } from './routes/internal.js';

/** The four internal callers and what each may do (TDD Auth DB, ADR-013). */
export const SERVICE_CLIENTS = [
  { clientId: 'delivery-worker', scopes: ['documents:ingest'] },
  { clientId: 'docbeam-api', scopes: ['memberships:read'] },
  { clientId: 'ws-handlers', scopes: ['memberships:read'] },
  { clientId: 'seed-script', scopes: ['users:read'] },
] as const;

/** `docbeam-api` is read from CLIENT_SECRET_DOCBEAM_API. */
export function secretEnvName(clientId: string): string {
  return `CLIENT_SECRET_${clientId.toUpperCase().replace(/-/g, '_')}`;
}

export interface ClientRow {
  clientId: string;
  clientSecretHash: string;
  scopes: string[];
}

export function clientRows(env: NodeJS.ProcessEnv): ClientRow[] {
  return SERVICE_CLIENTS.map((client) => {
    const secret = env[secretEnvName(client.clientId)];
    if (!secret) throw new Error(`${secretEnvName(client.clientId)} is not set`);
    return { clientId: client.clientId, clientSecretHash: hashClientSecret(secret), scopes: [...client.scopes] };
  });
}
