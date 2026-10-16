#!/usr/bin/env bash
# Builds the web app and publishes it to its S3 bucket, then clears the CloudFront cache.
#
#   scripts/deploy-web.sh <env>
#
# Reads the bucket and the distribution from the Terraform outputs of infra/envs/<env>.
# The state backend must be initialised (see the README). Prod is deployed only from CI.
set -euo pipefail

ENV_NAME="${1:?usage: scripts/deploy-web.sh <env>}"

if [ "$ENV_NAME" = "prod" ] && [ "${CI:-}" != "true" ]; then
  echo "Prod is deployed only by the GitHub workflows." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF="terraform -chdir=${ROOT}/infra/envs/${ENV_NAME}"
BUCKET="$($TF output -raw web_bucket)"
DISTRIBUTION="$($TF output -raw cloudfront_distribution_id)"
# The page connects to the WebSocket API directly, so its address is set at build time (D-G5).
WS_URL="$($TF output -raw ws_url)"

(cd "$ROOT" && VITE_WS_URL="$WS_URL" npm run build -w @docbeam/web)

DIST="${ROOT}/web/dist"
# Hashed assets never change, so they can be cached for a year. Everything else is revalidated.
aws s3 sync "$DIST" "s3://${BUCKET}" --delete \
  --exclude "index.html" --cache-control "public,max-age=31536000,immutable"
aws s3 cp "${DIST}/index.html" "s3://${BUCKET}/index.html" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths "/*" \
  --query 'Invalidation.Id' --output text

echo "Deployed to $($TF output -raw app_url)"
