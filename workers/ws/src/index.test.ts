import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler, type WsEvent } from './index.js';

afterEach(() => vi.restoreAllMocks());

describe('ws handler', () => {
  it.each(['$connect', 'subscribe', '$disconnect'])('logs %s and answers 200', async (routeKey) => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const event = { requestContext: { routeKey, connectionId: 'c-1' } } as unknown as WsEvent;
    expect(await handler(event)).toEqual({ statusCode: 200 });
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({ routeKey, connectionId: 'c-1' });
  });
});
