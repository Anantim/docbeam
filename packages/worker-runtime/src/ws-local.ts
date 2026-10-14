// A local stand-in for the API Gateway WebSocket API (ADR-007). Browsers connect to it as they would to
// the real API; it calls the WS handler for $connect, subscribe and $disconnect, and offers
// POST /@connections/{id}, shaped like the API Gateway management API, for pushes.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLogger } from '@docbeam/shared';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { WebSocketServer, type WebSocket } from 'ws';

export interface WsLocalEvent {
  requestContext: {
    routeKey: string;
    eventType: 'CONNECT' | 'MESSAGE' | 'DISCONNECT';
    connectionId: string;
    domainName: string;
    stage: string;
    requestId: string;
    connectedAt: number;
    requestTimeEpoch: number;
    apiId: string;
    messageId?: string;
  };
  queryStringParameters?: Record<string, string>;
  body?: string;
  isBase64Encoded: boolean;
}

export type WsHandler = (event: WsLocalEvent) => Promise<APIGatewayProxyResultV2>;

const log = createLogger('ws-local');
/** The routes the design defines. API Gateway picks the route from the message's `action`. */
const MESSAGE_ROUTES = new Set(['subscribe']);

function statusOf(result: APIGatewayProxyResultV2): number {
  return typeof result === 'object' && result !== null && 'statusCode' in result ? (result.statusCode ?? 200) : 200;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function startWsLocal(options: { port: number; handler: WsHandler }): Promise<Server> {
  const connections = new Map<string, { socket: WebSocket; connectedAt: number }>();
  const wss = new WebSocketServer({ noServer: true });

  const event = (
    routeKey: string,
    eventType: WsLocalEvent['requestContext']['eventType'],
    connectionId: string,
    connectedAt: number,
    extra: Partial<WsLocalEvent> = {},
  ): WsLocalEvent => ({
    requestContext: {
      routeKey,
      eventType,
      connectionId,
      domainName: 'localhost',
      stage: 'local',
      requestId: randomBytes(8).toString('hex'),
      connectedAt,
      requestTimeEpoch: Date.now(),
      apiId: 'ws-local',
    },
    isBase64Encoded: false,
    ...extra,
  });

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
        return;
      }
      const match = /^\/@connections\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'POST' && match?.[1]) {
        const id = decodeURIComponent(match[1]);
        const body = await readBody(req);
        const conn = connections.get(id);
        if (!conn) {
          res.writeHead(410, { 'content-type': 'application/json' }).end('{"message":"GoneException"}');
          return;
        }
        conn.socket.send(body);
        res.writeHead(200).end();
        return;
      }
      res.writeHead(404).end();
    })().catch((err: unknown) => {
      log.error('request failed', { error: String(err) });
      res.writeHead(500).end();
    });
  });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const connectionId = randomBytes(9).toString('base64url');
      const connectedAt = Date.now();
      const result = await options.handler(
        event('$connect', 'CONNECT', connectionId, connectedAt, {
          queryStringParameters: Object.fromEntries(url.searchParams),
        }),
      );
      const status = statusOf(result);
      if (status < 200 || status > 299) {
        socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        connections.set(connectionId, { socket: ws, connectedAt });
        ws.on('message', (data) => {
          const body = data.toString();
          let action: unknown;
          try {
            action = (JSON.parse(body) as { action?: unknown }).action;
          } catch {
            action = undefined;
          }
          if (typeof action !== 'string' || !MESSAGE_ROUTES.has(action)) {
            ws.send(JSON.stringify({ message: 'Forbidden' }));
            return;
          }
          void options.handler(event(action, 'MESSAGE', connectionId, connectedAt, { body }));
        });
        ws.on('close', () => {
          connections.delete(connectionId);
          void options.handler(event('$disconnect', 'DISCONNECT', connectionId, connectedAt));
        });
      });
    })().catch((err: unknown) => {
      log.error('connect failed', { error: String(err) });
      socket.destroy();
    });
  });

  return new Promise((resolve) => {
    server.listen(options.port, () => {
      log.info('ws-local listening', { port: (server.address() as AddressInfo).port });
      resolve(server);
    });
  });
}
