import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ApiError, registerErrorHandler } from './errors.js';

async function app() {
  const server = Fastify({ logger: false });
  registerErrorHandler(server);
  server.get('/conflict', async () => {
    throw new ApiError(409, 'FILE_ALREADY_SUBMITTED', 'That file is already in a distribution.');
  });
  server.get('/boom', async () => {
    throw new Error('database password is wrong');
  });
  server.post(
    '/strict',
    { schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
    async () => ({ ok: true }),
  );
  return server;
}

describe('registerErrorHandler', () => {
  it('sends an ApiError in the shared shape', async () => {
    const res = await (await app()).inject({ url: '/conflict' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'FILE_ALREADY_SUBMITTED', message: 'That file is already in a distribution.' },
    });
  });

  it('hides the detail of an unexpected error', async () => {
    const res = await (await app()).inject({ url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  });

  it('turns a schema failure into 400 VALIDATION_ERROR', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/strict', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('answers unknown routes with 404 NOT_FOUND', async () => {
    const res = await (await app()).inject({ url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
});
