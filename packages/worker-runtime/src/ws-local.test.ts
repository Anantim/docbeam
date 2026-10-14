import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startWsLocal, type WsLocalEvent } from './ws-local.js';

let server: Server | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = undefined;
});

async function start(status = 200) {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const events: WsLocalEvent[] = [];
  server = await startWsLocal({
    port: 0,
    handler: async (event) => {
      events.push(event);
      return { statusCode: event.requestContext.routeKey === '$connect' ? status : 200 };
    },
  });
  const port = (server.address() as AddressInfo).port;
  return { events, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}` };
}

function waitFor(check: () => boolean): Promise<void> {
  return vi.waitFor(() => {
    if (!check()) throw new Error('not yet');
  });
}

describe('ws-local', () => {
  it('answers 410 when posting to an unknown connection', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/@connections/nobody`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(410);
  });

  it('calls the handler for $connect, subscribe and $disconnect, and delivers posts', async () => {
    const { events, base, ws } = await start();
    const client = new WebSocket(`${ws}/?token=abc`);
    const received: string[] = [];
    client.on('message', (d) => received.push(d.toString()));
    await new Promise((resolve) => client.once('open', resolve));

    const connect = events[0];
    expect(connect?.requestContext.routeKey).toBe('$connect');
    expect(connect?.queryStringParameters).toEqual({ token: 'abc' });
    const id = connect?.requestContext.connectionId ?? '';

    client.send(JSON.stringify({ action: 'subscribe', jobId: 'j-1' }));
    await waitFor(() => events.some((e) => e.requestContext.routeKey === 'subscribe'));

    const res = await fetch(`${base}/@connections/${encodeURIComponent(id)}`, { method: 'POST', body: '{"type":"task_update"}' });
    expect(res.status).toBe(200);
    await waitFor(() => received.includes('{"type":"task_update"}'));

    client.close();
    await waitFor(() => events.some((e) => e.requestContext.routeKey === '$disconnect'));
    expect((await fetch(`${base}/@connections/${encodeURIComponent(id)}`, { method: 'POST', body: '{}' })).status).toBe(410);
  });

  it('refuses the connection when $connect does not answer 2xx', async () => {
    const { ws } = await start(401);
    const client = new WebSocket(`${ws}/?token=bad`);
    const status = await new Promise<number | undefined>((resolve) => {
      client.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      client.on('error', () => resolve(undefined));
    });
    expect(status).toBe(401);
  });
});
