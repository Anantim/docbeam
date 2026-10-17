import { ApiError, createServiceTokenClient, type ServiceTokenClient } from '@docbeam/shared';
import type { Config } from './config.js';

export interface DestinationInput {
  binderId: string;
  folderId: string | null;
}

export interface ResolvedDestination extends DestinationInput {
  teamId: string;
  teamName: string;
  path: string;
}

export type CheckResult =
  | { ok: true; destinations: ResolvedDestination[] }
  | { ok: false; notFound: DestinationInput[] };

/** The Document Platform, as DocBeam API sees it (ADR-006, ADR-013). */
export interface PlatformClient {
  /** One call for the whole batch. The answer for a missing binder and one in another team is the same. */
  checkDestinations(userId: string, destinations: DestinationInput[]): Promise<CheckResult>;
  /** The teams a user belongs to, cached for 60 seconds (TDD Step 3.1). Throws 503 PLATFORM_UNAVAILABLE. */
  userTeams(userId: string): Promise<string[]>;
  /** Fetch the service token now and keep it fresh in the background. */
  start(): Promise<void>;
  stop(): void;
}

const TIMEOUT_MS = 5_000;
/** How long a user's teams are reused (TDD Step 3.1). Membership changes show within a minute. */
export const TEAMS_CACHE_MS = 60_000;

export function createPlatformClient(
  config: Pick<Config, 'AUTH_URL' | 'PLATFORM_URL' | 'CLIENT_SECRET_DOCBEAM_API'>,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): PlatformClient {
  const tokens: ServiceTokenClient = createServiceTokenClient({
    authUrl: config.AUTH_URL,
    clientId: 'docbeam-api',
    clientSecret: config.CLIENT_SECRET_DOCBEAM_API,
    scope: 'memberships:read',
    fetchImpl,
  });

  const unavailable = (): ApiError =>
    new ApiError(503, 'PLATFORM_UNAVAILABLE', 'The platform is not answering. Try again in a moment.');

  async function post(userId: string, destinations: DestinationInput[]): Promise<Response> {
    return fetchImpl(`${config.PLATFORM_URL}/destinations/check`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await tokens.get()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ userId, destinations }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  const teamCache = new Map<string, { teams: string[]; expires: number }>();

  async function getTeams(userId: string): Promise<Response> {
    return fetchImpl(`${config.PLATFORM_URL}/users/${encodeURIComponent(userId)}/teams`, {
      headers: { authorization: `Bearer ${await tokens.get()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  return {
    async userTeams(userId) {
      const hit = teamCache.get(userId);
      if (hit && hit.expires > now()) return hit.teams;
      let res: Response;
      try {
        res = await getTeams(userId);
        if (res.status === 401) {
          tokens.invalidate();
          res = await getTeams(userId);
        }
      } catch {
        throw unavailable();
      }
      if (res.status !== 200) throw unavailable();
      const body = (await res.json()) as { teamIds?: string[] };
      const teams = body.teamIds ?? [];
      teamCache.set(userId, { teams, expires: now() + TEAMS_CACHE_MS });
      return teams;
    },
    async checkDestinations(userId, destinations) {
      let res: Response;
      try {
        res = await post(userId, destinations);
        if (res.status === 401) {
          // The token was rejected (for example a signing key moved): get a new one and try once more.
          tokens.invalidate();
          res = await post(userId, destinations);
        }
      } catch {
        throw unavailable();
      }

      if (res.status === 200) {
        const body = (await res.json()) as { destinations: ResolvedDestination[] };
        return { ok: true, destinations: body.destinations };
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as { notFound?: DestinationInput[] };
        return { ok: false, notFound: body.notFound ?? [] };
      }
      throw unavailable();
    },
    start: () => tokens.start(),
    stop: () => tokens.stop(),
  };
}
