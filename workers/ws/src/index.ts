import {
  createLogger,
  createPoster,
  createSecretReader,
  createServiceTokenClient,
  createTokenVerifier,
  lambdaPoolConfig,
  type Poster,
} from '@docbeam/shared';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import pg from 'pg';
import { createHandler, type WsDeps, type WsEvent } from './handler.js';

export type { WsEvent } from './handler.js';

const log = createLogger('ws');

let cached: Promise<WsDeps> | undefined;

/** Built once per cold start. Locally `.env` gives plain values; on AWS secrets are read by ARN (D-M2-5). */
function runtimeFromEnv(): Promise<WsDeps> {
  cached ??= (async () => {
    const env = process.env;
    const need = (name: string): string => {
      const value = env[name];
      if (!value) throw new Error(`${name} is not set.`);
      return value;
    };
    const secrets = createSecretReader(env);
    const pool = new pg.Pool(await lambdaPoolConfig(env, secrets));
    const verify = createTokenVerifier({ issuer: need('JWT_ISSUER'), jwksUrl: need('JWKS_URL') });
    const tokens = createServiceTokenClient({
      authUrl: need('AUTH_URL'),
      clientId: 'ws-handlers',
      clientSecret: () => secrets.readField('CLIENT_SECRET_WS_HANDLERS', 'client_secret'),
      scope: 'memberships:read',
    });
    const platformUrl = need('PLATFORM_URL');

    async function fetchTeams(userId: string): Promise<Response> {
      return fetch(`${platformUrl}/users/${encodeURIComponent(userId)}/teams`, {
        headers: { authorization: `Bearer ${await tokens.get()}` },
        signal: AbortSignal.timeout(5_000),
      });
    }

    // One poster per management address. API Gateway gives the address in the event; locally env sets it.
    const posters = new Map<string, Poster>();
    return {
      db: pool as unknown as WsDeps['db'],
      verify,
      async teamsOf(userId) {
        let res = await fetchTeams(userId);
        if (res.status === 401) {
          tokens.invalidate();
          res = await fetchTeams(userId);
        }
        if (res.status !== 200) throw new Error(`The platform answered ${res.status}.`);
        return ((await res.json()) as { teamIds?: string[] }).teamIds ?? [];
      },
      posterFor(event) {
        const { domainName, stage } = event.requestContext;
        const endpoint = env.WS_MANAGEMENT_ENDPOINT ?? (domainName && stage ? `https://${domainName}/${stage}` : undefined);
        if (!endpoint) return undefined;
        let poster = posters.get(endpoint);
        if (!poster) {
          poster = createPoster(endpoint);
          posters.set(endpoint, poster);
        }
        return poster;
      },
      log,
    };
  })();
  return cached;
}

/** WS Handlers for $connect, subscribe and $disconnect (ADR-007). */
export const handler: (event: WsEvent) => Promise<APIGatewayProxyResultV2> = createHandler(runtimeFromEnv);
