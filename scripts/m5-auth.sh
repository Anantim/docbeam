#!/usr/bin/env bash
# Check 5.11: a refresh token used twice ends the sign-in; 5 wrong passwords pause sign-in for 15 minutes.
# Registers throwaway users m5.<tag>.<time>@example.com. Takes about 16 minutes; --no-wait skips the last wait.
#   scripts/m5-auth.sh [--no-wait]
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" auth "$@"
