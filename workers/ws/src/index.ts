import { createLogger } from '@docbeam/shared';
import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';

const log = createLogger('ws');

/** The $connect event also carries the query string, where the browser puts its token. */
export type WsEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string | undefined>;
};

/** WS Handlers for $connect, subscribe and $disconnect (ADR-007). */
export async function handler(event: WsEvent): Promise<APIGatewayProxyResultV2> {
  const { routeKey, connectionId } = event.requestContext;
  log.info('websocket event', { routeKey, connectionId });
  return { statusCode: 200 };
}
