#!/usr/bin/env bash
# Check 5.6: a 1 GiB multipart upload completes, is checked by its combined checksum, is scanned, and is delivered
# with a matching SHA-256 (read from the platform's documents table). The data is generated, so no disk is needed.
#   scripts/m5-multipart-1gb.sh
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" multipart-1gb "$@"
