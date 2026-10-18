import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { acceptEmptyBodies, ApiError, registerErrorHandler } from './errors.js';

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

describe('acceptEmptyBodies', () => {
  async function bodyApp() {
    const server = Fastify({ logger: false });
    registerErrorHandler(server);
    acceptEmptyBodies(server);
    server.post('/act', async (request) => ({ ok: true, body: request.body ?? null }));
    server.post('/json', async (request) => ({ body: request.body }));
    return server;
  }

  it('accepts a POST with no body, with or without a content type', async () => {
    const server = await bodyApp();
    expect((await server.inject({ method: 'POST', url: '/act' })).statusCode).toBe(200);
    const typed = await server.inject({ method: 'POST', url: '/act', headers: { 'content-type': 'application/octet-stream' }, payload: '' });
    expect(typed.statusCode).toBe(200);
  });

  it('still refuses a body of a type no route reads, and still reads JSON', async () => {
    const server = await bodyApp();
    const form = await server.inject({ method: 'POST', url: '/act', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'a=1' });
    expect(form.statusCode).toBe(415);
    expect(form.json().error.code).toBe('VALIDATION_ERROR');
    const json = await server.inject({ method: 'POST', url: '/json', payload: { a: 1 } });
    expect(json.json()).toEqual({ body: { a: 1 } });
  });
});
