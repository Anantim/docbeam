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

/**
 * The same for the migrate and seed tasks: MIGRATION_DATABASE_URL, or the DB_* parts with the
 * master user and password from MIGRATION_DB_USER and MIGRATION_DB_PASSWORD (D-M1-10).
 */
export function withMigrationUrl(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.MIGRATION_DATABASE_URL) return env;
  const built = withDatabaseUrl({
    DB_HOST: env.DB_HOST,
    DB_PORT: env.DB_PORT,
    DB_NAME: env.DB_NAME,
    DB_USER: env.MIGRATION_DB_USER,
    DB_PASSWORD: env.MIGRATION_DB_PASSWORD,
  });
  return built.DATABASE_URL ? { ...env, MIGRATION_DATABASE_URL: built.DATABASE_URL } : env;
}
