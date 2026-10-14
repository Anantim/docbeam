import { withDatabaseUrl } from '@docbeam/shared';
import { z } from 'zod';

const schema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3003),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** The docbeam_app role. Runtime queries only. */
  DATABASE_URL: z.string().url(),
  /** The public API address that issues tokens, for example https://<cloudfront>/api (D-G5). */
  JWT_ISSUER: z.string().url(),
  JWKS_URL: z.string().url(),
  /** The Object Store bucket that holds staged uploads. */
  OBJECT_STORE_BUCKET: z.string().min(3),
  AWS_REGION: z.string().default('ap-southeast-2'),
  /** LocalStack, in Compose only. Setting it also switches on path-style addressing. */
  AWS_ENDPOINT_URL: z.string().url().optional(),
  /** The S3 address the browser can reach, when it differs from AWS_ENDPOINT_URL (D-M2-11). Unset on AWS. */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(withDatabaseUrl(env));
}
