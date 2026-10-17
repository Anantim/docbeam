// WS Handlers for $connect, subscribe and $disconnect (ADR-007, TDD "WebSocket API"). The WebSocket API only
// holds raw connections; these handlers keep `ws_connections` right, and Delivery, the DLQ Consumer and the
// DocBeam API read it to find who watches which job.
import {
  ApiError,
  type Logger,
  type Poster,
  type Queryable,
  type TokenVerifier,
} from '@docbeam/shared';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';

/** The part of the event these handlers read. The $connect event also carries the query string. */
export interface WsEvent {
  requestContext: { routeKey: string; connectionId: string; domainName?: string; stage?: string };
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
}

export interface WsDeps {
  db: Queryable;
  verify: TokenVerifier;
  /** The caller's teams from the Document Platform, with a service token (scope memberships:read). */
  teamsOf(userId: string): Promise<string[]>;
  /** A poster for the connection's management address, built from the event when the env gives none. */
  posterFor(event: WsEvent): Poster | undefined;
  log: Logger;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The browser subscribes, waits for `subscribed`, and only then fetches the job's tasks, so no update falls
 * between the fetch and the first push (TDD Step 3.3). A refusal is sent the same way: the page shows "not found".
 */
export type SubscribeReply =
  | { type: 'subscribed'; jobId: string }
  | { type: 'subscribe_error'; jobId: string | null; code: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'UNAVAILABLE' };

export function createHandler(runtime: () => Promise<WsDeps>) {
  return async function handler(event: WsEvent): Promise<APIGatewayProxyResultV2> {
    const deps = await runtime();
    const { routeKey, connectionId } = event.requestContext;
    deps.log.info('websocket event', { routeKey, connectionId });
    try {
      switch (routeKey) {
        case '$connect':
          return await connect(deps, event);
        case 'subscribe':
          return await subscribe(deps, event);
        case '$disconnect':
          await deps.db.query('DELETE FROM ws_connections WHERE connection_id = $1', [connectionId]);
          return { statusCode: 200 };
        default:
          return { statusCode: 400 };
      }
    } catch (error) {
      deps.log.error('websocket handler failed', { routeKey, connectionId, error: String(error) });
      return { statusCode: 500 };
    }
  };
}

/** Reads the JWT from the query string (browsers cannot set headers on the handshake) and records the connection. */
async function connect(deps: WsDeps, event: WsEvent): Promise<APIGatewayProxyResultV2> {
  const token = event.queryStringParameters?.token;
  if (!token) return { statusCode: 401 };
  let principal;
  try {
    principal = await deps.verify(token, { use: 'user' });
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) return { statusCode: 401 };
    throw error;
  }
  if (principal.tokenUse !== 'user') return { statusCode: 401 };
  // The row keeps the token's expiry; nothing is pushed after it, so a removed member stops within 15 minutes.
  await deps.db.query(
    `INSERT INTO ws_connections (connection_id, user_id, expires_at)
     VALUES ($1, $2, to_timestamp($3))
     ON CONFLICT (connection_id) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at`,
    [event.requestContext.connectionId, principal.userId, principal.expiresAt],
  );
  return { statusCode: 200 };
}

async function subscribe(deps: WsDeps, event: WsEvent): Promise<APIGatewayProxyResultV2> {
  const { connectionId } = event.requestContext;
  const post = deps.posterFor(event);
  const reply = async (message: SubscribeReply): Promise<void> => {
    if (!post) return;
    await post(connectionId, JSON.stringify(message)).catch((error: unknown) =>
      deps.log.warn('subscribe reply not sent', { connectionId, error: String(error) }),
    );
  };

  let jobId: unknown;
  try {
    jobId = (JSON.parse(event.body ?? '{}') as { jobId?: unknown }).jobId;
  } catch {
    jobId = undefined;
  }
  if (typeof jobId !== 'string' || !UUID.test(jobId)) {
    await reply({ type: 'subscribe_error', jobId: null, code: 'VALIDATION_ERROR' });
    return { statusCode: 400 };
  }

  const conn = await deps.db.query<{ user_id: string }>(
    'SELECT user_id FROM ws_connections WHERE connection_id = $1 AND expires_at > now()',
    [connectionId],
  );
  const userId = conn.rows[0]?.user_id;
  if (!userId) return { statusCode: 403 };

  // Whatever the answer, the connection stops watching its earlier job first.
  const job = await deps.db.query<{ submitted_by_user_id: string }>('SELECT submitted_by_user_id FROM jobs WHERE id = $1', [jobId]);
  const sender = job.rows[0]?.submitted_by_user_id;

  let allowed = false;
  let teams: string[] = [];
  if (sender === userId) {
    allowed = true;
  } else if (sender) {
    try {
      teams = await deps.teamsOf(userId);
    } catch (error) {
      deps.log.warn('teams not available', { connectionId, error: String(error) });
      await reply({ type: 'subscribe_error', jobId, code: 'UNAVAILABLE' });
      return { statusCode: 503 };
    }
    if (teams.length > 0) {
      const hit = await deps.db.query('SELECT 1 FROM tasks WHERE job_id = $1 AND team_id = ANY($2::uuid[]) LIMIT 1', [jobId, teams]);
      allowed = hit.rows.length > 0;
    }
  }

  if (!allowed) {
    await deps.db.query('UPDATE ws_connections SET job_id = NULL, team_ids = \'{}\' WHERE connection_id = $1', [connectionId]);
    // The same answer for a job that does not exist and one the caller may not see.
    await reply({ type: 'subscribe_error', jobId, code: 'NOT_FOUND' });
    return { statusCode: 404 };
  }

  await deps.db.query('UPDATE ws_connections SET job_id = $2, team_ids = $3::uuid[] WHERE connection_id = $1', [connectionId, jobId, teams]);
  await reply({ type: 'subscribed', jobId });
  return { statusCode: 200 };
}
