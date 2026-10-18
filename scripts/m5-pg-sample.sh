#!/usr/bin/env bash
# Samples pg_stat_activity of the DocBeam database on dev for a number of minutes, in a one-off task, and prints the
# SAMPLE lines (check 5.1 diagnosis, D-M5-16). Read only: one extra database connection.
#   scripts/m5-pg-sample.sh 12
set -euo pipefail
MINUTES="${1:-10}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODE="$(base64 -w0 "$ROOT/scripts/m5/pg-sampler.js")"
exec "$ROOT/scripts/run-task.sh" dev docbeam-api service sh -c "SAMPLE_MINUTES=$MINUTES node --input-type=module -e \"\$(echo $CODE | base64 -d)\""
