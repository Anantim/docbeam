#!/usr/bin/env bash
# Deploys the code of one worker Lambda: a bundle (a directory or a .zip) or a container image.
#
#   scripts/deploy-lambda.sh <env> <function> <bundle-dir | bundle.zip | image-uri> [--force]
#
# <function> is fanout, delivery, dlq, ws, sweeper or upload-events. The Lambda is docbeam-<env>-<function>.
# Terraform creates each function from a placeholder or the first image and then ignores code changes
# (D-M2-6), as the ECS services are handled by deploy-service.sh.
#
# Safe to run twice and while an environment is down, like deploy-service.sh (D-M1-14, D-M1-15):
#   - the function does not exist (dev is down, or the worker is not built yet): a notice, exit 0;
#   - it already runs this code (same package SHA-256, or same image URI): a notice, exit 0.
# --force or FORCE_DEPLOY=true skips the second check.
#
# A directory is zipped with fixed file times and a sorted file list, so the same bundle gives the same
# SHA-256 and the check can tell "unchanged" from "changed".
set -euo pipefail

ENV_NAME="${1:?usage: scripts/deploy-lambda.sh <env> <function> <bundle-dir|bundle.zip|image-uri> [--force]}"
FUNCTION="${2:?missing function}"
CODE="${3:?missing bundle or image uri}"
FORCE="${FORCE_DEPLOY:-false}"
[ "${4:-}" = "--force" ] && FORCE=true

if [ "$ENV_NAME" = "prod" ] && [ "${CI:-}" != "true" ]; then
  echo "Prod is deployed only by the GitHub workflows." >&2
  exit 1
fi

REGION="${AWS_REGION:-ap-southeast-2}"
NAME="docbeam-${ENV_NAME}-${FUNCTION}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

notice() {
  echo "$1"
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::notice title=Lambda deploy skipped::$1"
  fi
}

# Does the function exist? get-function-configuration also gives the running package hash.
if ! RUNNING_SHA="$(aws lambda get-function-configuration --region "$REGION" --function-name "$NAME" \
  --query CodeSha256 --output text 2>/dev/null)"; then
  notice "${NAME} does not exist (the environment is down, or this worker is not built yet). Nothing to do."
  exit 0
fi

if [ -d "$CODE" ] || [[ "$CODE" == *.zip ]]; then
  ZIP="$CODE"
  if [ -d "$CODE" ]; then
    ZIP="${TMP}/${FUNCTION}.zip"
    # Fixed times and a sorted list: the same files always make the same zip.
    (cd "$CODE" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 touch -h -d '2000-01-01 00:00:00 UTC' \
      && find . -type f -print | LC_ALL=C sort | zip -q -X -@ "$ZIP")
  fi
  NEW_SHA="$(openssl dgst -sha256 -binary "$ZIP" | base64 -w0)"
  if [ "$FORCE" != "true" ] && [ "$RUNNING_SHA" = "$NEW_SHA" ]; then
    notice "${NAME} already runs this code. Nothing to do (use --force or FORCE_DEPLOY=true to redeploy)."
    exit 0
  fi
  aws lambda update-function-code --region "$REGION" --function-name "$NAME" \
    --zip-file "fileb://${ZIP}" --query LastUpdateStatus --output text
else
  if [ "$FORCE" != "true" ]; then
    RUNNING_IMAGE="$(aws lambda get-function --region "$REGION" --function-name "$NAME" \
      --query Code.ImageUri --output text 2>/dev/null || true)"
    if [ "$RUNNING_IMAGE" = "$CODE" ]; then
      notice "${NAME} already runs ${CODE}. Nothing to do (use --force or FORCE_DEPLOY=true to redeploy)."
      exit 0
    fi
  fi
  aws lambda update-function-code --region "$REGION" --function-name "$NAME" \
    --image-uri "$CODE" --query LastUpdateStatus --output text
fi

aws lambda wait function-updated --region "$REGION" --function-name "$NAME"
echo "Deployed the new code to ${NAME}"
