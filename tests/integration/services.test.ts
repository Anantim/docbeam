import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { eventually, logLines } from './helpers.js';

describe('services', () => {
  it.each([
    ['auth', 3001],
    ['platform', 3002],
    ['docbeam-api', 3003],
  ])('%s answers /health with 200', async (service, port) => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service });
  });

  it('answers an unknown route with 404 in the shared error shape', async () => {
    const res = await fetch('http://localhost:3003/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
});

describe('ws-local', () => {
  it('runs the WS handler for $connect, subscribe and $disconnect, and pushes through @connections', async () => {
    const since = new Date(Date.now() - 1000);
    const client = new WebSocket('ws://localhost:3004/?token=test');
    const received: string[] = [];
    client.on('message', (d) => received.push(d.toString()));
    await new Promise((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    const connect = await eventually(() =>
      logLines('ws-local', since).find((l) => l.name === 'ws' && l.routeKey === '$connect'),
    );
    const id = String(connect.connectionId);

    client.send(JSON.stringify({ action: 'subscribe', jobId: crypto.randomUUID() }));
    await eventually(() => logLines('ws-local', since).find((l) => l.routeKey === 'subscribe' && l.connectionId === id));

    const res = await fetch(`http://localhost:3004/@connections/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: '{"type":"task_update"}',
    });
    expect(res.status).toBe(200);
    await eventually(() => received.includes('{"type":"task_update"}'));

    client.close();
    await eventually(() => logLines('ws-local', since).find((l) => l.routeKey === '$disconnect' && l.connectionId === id));
  });
});

describe('clamav', () => {
  it('answers PING with PONG on 3310', async () => {
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(3310, 'localhost', () => socket.write('zPING\0'));
      let data = '';
      socket.on('data', (d) => (data += d.toString()));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    expect(reply.replace(/\0/g, '')).toBe('PONG');
  });
});
