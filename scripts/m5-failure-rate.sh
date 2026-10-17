#!/usr/bin/env bash
# The delivery failure rate (blueprint success metric): system failures (RETRIES_EXHAUSTED, FANOUT_FAILED) over all
# tasks that were not cancelled, over the last N days, from a one-off task in the DocBeam API's network. Prints JSON.
#   scripts/m5-failure-rate.sh [days] [since-iso-timestamp]
set -euo pipefail
cd "$(dirname "$0")/.."
DAYS="${1:-7}"
SINCE="${2:-}"
OUT="$(scripts/run-task.sh dev docbeam-api service node dist/failure-rate-run.js "$DAYS" ${SINCE:+"$SINCE"})"
echo "$OUT" | grep -E '^\{"days"' || { echo "$OUT" >&2; exit 1; }
