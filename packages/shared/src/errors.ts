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
