import { z } from 'zod';

const schema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** The auth_app role. Runtime queries only. */
  DATABASE_URL: z.string().url(),
  /** The public API address that issues tokens, for example https://<cloudfront>/api (D-G5). */
  JWT_ISSUER: z.string().url(),
  JWKS_URL: z.string().url(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
