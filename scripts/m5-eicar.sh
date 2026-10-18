#!/usr/bin/env bash
# Check 5.9: the EICAR test file is refused as infected before submit, its object is deleted, and it can never be
# downloaded.
#   scripts/m5-eicar.sh
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" eicar "$@"
