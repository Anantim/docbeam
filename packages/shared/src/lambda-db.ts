import { LAMBDA_POOL, type PoolLimits } from './db.js';
import { withDatabaseUrl } from './db-url.js';
import type { SecretReader } from './secrets.js';

export type LambdaPoolConfig = PoolLimits & { connectionString: string };

/**
 * The options for a Lambda's `pg` Pool (one connection, D-M0-6). Locally DATABASE_URL is set. On AWS the
 * function has DB_HOST and DB_NAME from Terraform and the role's user and password in the secret named by
 * DB_SECRET_ARN (D-M2-5). Whether the host is an RDS Proxy or the instance does not matter here.
 */
export async function lambdaPoolConfig(env: NodeJS.ProcessEnv, secrets: SecretReader): Promise<LambdaPoolConfig> {
  let source = env;
  if (!env.DATABASE_URL) {
    source = {
      ...env,
      DB_USER: await secrets.readField('DB_SECRET', 'username'),
      DB_PASSWORD: await secrets.readField('DB_SECRET', 'password'),
    };
  }
  const connectionString = withDatabaseUrl(source).DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL, or DB_HOST, DB_NAME and DB_SECRET_ARN.');
  return { connectionString, ...LAMBDA_POOL };
}
