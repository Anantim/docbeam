/**
 * Locally the services get one DATABASE_URL. On AWS, ECS injects the role's user and password from its
 * secret (which holds no host) next to DB_HOST and DB_NAME from Terraform, so the URL is built here (D-M1-10).
 * RDS uses a certificate that Node does not know, so the connection is encrypted without chain checks.
 */
export function withDatabaseUrl(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.DATABASE_URL) return env;
  const { DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT } = env;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) return env;
  const user = encodeURIComponent(DB_USER);
  const password = encodeURIComponent(DB_PASSWORD);
  const url = `postgres://${user}:${password}@${DB_HOST}:${DB_PORT ?? '5432'}/${DB_NAME}?sslmode=no-verify`;
  return { ...env, DATABASE_URL: url };
}
