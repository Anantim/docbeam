#!/usr/bin/env bash
# Builds a Docker image for linux/amd64 and pushes it to ECR, tagged with the git SHA.
#
#   scripts/push-image.sh <env> <repository> <dockerfile> [docker build args...]
#
# Examples:
#   scripts/push-image.sh dev db-bootstrap docker/db-bootstrap/Dockerfile
#   scripts/push-image.sh dev auth docker/service.Dockerfile --build-arg SERVICE=auth
#
# The repository is docbeam-<env>/<repository>. Tags are immutable, so a SHA that is already
# pushed is skipped. The db-bootstrap repository is the one exception: it also gets the moving
# tag `bootstrap`, which its task definition runs. Prod is pushed only from CI.
set -euo pipefail

if [ $# -lt 3 ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

ENV_NAME="$1"
REPOSITORY="$2"
DOCKERFILE="$3"
shift 3

if [ "$ENV_NAME" = "prod" ] && [ "${CI:-}" != "true" ]; then
  echo "Prod images are pushed only by the GitHub workflows." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-2}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
REPO_NAME="docbeam-${ENV_NAME}/${REPOSITORY}"
IMAGE="${REGISTRY}/${REPO_NAME}"
# IMAGE_TAG lets the daily Upload Events rebuild push the same commit again with fresh virus definitions.
TAG="${IMAGE_TAG:-$(git -C "$ROOT" rev-parse --short=12 HEAD)}"

if [ -z "${IMAGE_TAG:-}" ] && ! git -C "$ROOT" diff --quiet HEAD -- 2>/dev/null; then
  TAG="${TAG}-dirty"
fi

aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$REGION" >/dev/null

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

if aws ecr describe-images --repository-name "$REPO_NAME" --image-ids "imageTag=${TAG}" --region "$REGION" >/dev/null 2>&1; then
  echo "${IMAGE}:${TAG} is already in ECR."
else
  docker build --platform linux/amd64 -f "${ROOT}/${DOCKERFILE}" -t "${IMAGE}:${TAG}" "$@" "$ROOT"
  docker push "${IMAGE}:${TAG}"
fi

if [ "$REPOSITORY" = "db-bootstrap" ]; then
  docker pull -q "${IMAGE}:${TAG}" >/dev/null
  docker tag "${IMAGE}:${TAG}" "${IMAGE}:bootstrap"
  docker push "${IMAGE}:bootstrap"
fi

echo "${IMAGE}:${TAG}"
