import { ApiError } from '@docbeam/shared';
import type { z } from 'zod';

/** Parses a request body or query. Any failure is the one 400 VALIDATION_ERROR shape. */
export function parse<T extends z.ZodType>(schema: T, input: unknown, message = 'The request is not valid.'): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', message);
  return result.data;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
