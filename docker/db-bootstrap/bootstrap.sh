#!/usr/bin/env bash
# Creates DocBeam's three databases and their roles (ADR-009, D-G8). Safe to run again.
# Runs in the local Postgres container on first start, and on AWS as a one-off ECS task.
#
# Needs the standard libpq variables for the admin login (PGHOST, PGPORT, PGUSER, PGPASSWORD,
# optionally PGSSLMODE) and the three app-role passwords:
#   AUTH_APP_PASSWORD, PLATFORM_APP_PASSWORD, DOCBEAM_APP_PASSWORD
#
# For each of auth, platform and docbeam it makes:
#   <name>_owner  NOLOGIN, owns the database and every table; migrations run as it (D-M0-2)
#   <name>_app    LOGIN, used by the service at run time; read and write on tables, nothing else
#   <name>_db     the database, owned by <name>_owner, reachable only by <name>_app and the admin login
set -euo pipefail

: "${AUTH_APP_PASSWORD:?}" "${PLATFORM_APP_PASSWORD:?}" "${DOCBEAM_APP_PASSWORD:?}"
export PGDATABASE="${PGDATABASE:-postgres}"
psql_admin() { psql -v ON_ERROR_STOP=1 -q -X "$@"; }

setup() {
  local name=$1 password=$2
  local owner="${name}_owner" app="${name}_app" db="${name}_db"

  psql_admin -v owner="$owner" -v app="$app" -v db="$db" -v pw="$password" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN', :'owner')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
ALTER ROLE :"app" WITH LOGIN PASSWORD :'pw';
ALTER ROLE :"owner" WITH NOLOGIN;
-- The admin login may switch to the owner role to run migrations, without inheriting its rights.
GRANT :"owner" TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
-- On RDS the admin login is not a superuser, so grants are made as the owner.
SET ROLE :"owner";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"app";
RESET ROLE;
SQL

  psql_admin -d "$db" -v owner="$owner" -v app="$app" <<'SQL'
SET ROLE :"owner";
CREATE EXTENSION IF NOT EXISTS citext;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"app";
RESET ROLE;
SQL
  echo "{\"level\":\"info\",\"msg\":\"database ready\",\"database\":\"$db\",\"owner\":\"$owner\",\"app\":\"$app\"}"
}

setup auth "$AUTH_APP_PASSWORD"
setup platform "$PLATFORM_APP_PASSWORD"
setup docbeam "$DOCBEAM_APP_PASSWORD"

psql_admin -t -A -F ' ' -c "SELECT 'role', rolname, CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END
  FROM pg_roles WHERE rolname ~ '^(auth|platform|docbeam)_(owner|app)$' ORDER BY rolname"
psql_admin -t -A -F ' ' -c "SELECT 'database', datname, pg_get_userbyid(datdba)
  FROM pg_database WHERE datname IN ('auth_db', 'platform_db', 'docbeam_db') ORDER BY datname"
echo '{"level":"info","msg":"bootstrap finished"}'
