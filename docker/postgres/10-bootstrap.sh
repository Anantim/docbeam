#!/usr/bin/env bash
# Runs once, when the local Postgres volume is first created. Uses the same script as the AWS bootstrap task.
set -euo pipefail
PGUSER="$POSTGRES_USER" /bootstrap/bootstrap.sh
