#!/usr/bin/env bash
# Runs the M5 checks one after another on dev and keeps each output in docs/testing/m5-evidence/<check>.txt.
# A failing check does not stop the others. Prints one line per check at the end and exits 1 if any failed.
# Checks that change AWS run with --yes (the person gave standing approval for this run, D-M5-0).
#
#   scripts/m5-all.sh                      # every check, in the set order
#   scripts/m5-all.sh browse eicar         # only these
set -uo pipefail
cd "$(dirname "$0")/.."

OUT=docs/testing/m5-evidence
mkdir -p "$OUT"
ALL=(security team-viewer browse eicar file-checks submit-load cancel removed-member platform-outage sweeper multipart-1gb failover)
CHECKS=("$@")
[ "${#CHECKS[@]}" -gt 0 ] || CHECKS=("${ALL[@]}")

script_for() {
  case "$1" in
    security) echo scripts/m5-security.sh ;;
    team-viewer) echo scripts/m5-team-viewer.sh ;;
    browse) echo scripts/m5-browse-timing.sh ;;
    eicar) echo scripts/m5-eicar.sh ;;
    file-checks) echo scripts/m5-file-checks.sh ;;
    submit-load) echo scripts/m5-submit-load.sh ;;
    cancel) echo scripts/m5-cancel.sh ;;
    removed-member) echo scripts/m5-removed-member.sh ;;
    platform-outage) echo scripts/m5-platform-outage.sh ;;
    sweeper) echo scripts/m5-sweeper.sh ;;
    multipart-1gb) echo scripts/m5-multipart-1gb.sh ;;
    failover) echo scripts/m5-failover.sh ;;
    auth) echo scripts/m5-auth.sh ;;
    *) echo "unknown check: $1" >&2; return 1 ;;
  esac
}

FAILED=0
for name in "${CHECKS[@]}"; do
  script="$(script_for "$name")" || exit 64
  echo "== $name  $(date -u +%H:%M:%S)"
  "$script" --yes >"$OUT/$name.txt" 2>&1
  rc=$?
  tail -n 1 "$OUT/$name.txt"
  echo "$name exit=$rc $(date -u +%FT%TZ)" >>"$OUT/summary.txt"
  [ "$rc" -eq 0 ] || FAILED=1
done
exit "$FAILED"
