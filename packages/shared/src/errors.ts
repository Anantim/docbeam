import type { FastifyError, FastifyInstance } from 'fastify';
import type { ErrorCode } from './constants.js';

/** The one error shape every route returns. */
export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Throw this from a route; the error handler turns it into the error shape. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A POST with no body and no content type (cancel, retry, a download link, a token refresh) must work for any
 * client (D-M5-5). Through CloudFront and the gateway such a request can arrive chunked with nothing in it, which
 * Fastify answers with 415 unless a catch-all parser exists. An empty body is accepted; a body of a type no route
 * reads is still refused with 415.
 */
export function acceptEmptyBodies(app: FastifyInstance): void {
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    if (body.length === 0) return done(null, undefined);
    done(new ApiError(415, 'VALIDATION_ERROR', 'Send the body as application/json.'), undefined);
  });
}

/** Sends every error, including schema and not-found errors, in the shared shape. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | ApiError, request, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send(errorBody(err.code, err.message));
    }
    if ('validation' in err && err.validation) {
      return reply.status(400).send(errorBody('VALIDATION_ERROR', err.message));
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err }, 'request failed');
      return reply.status(500).send(errorBody('INTERNAL_ERROR', 'Something went wrong.'));
    }
    return reply.status(status).send(errorBody(status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', err.message));
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send(errorBody('NOT_FOUND', 'Not found.')));
}
