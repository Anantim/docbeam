#!/usr/bin/env bash
# Deploys one ECS service from an image that is already in ECR: runs its migrations as a one-off
# task, then points the service at a new task definition and waits for it to settle.
#
#   scripts/deploy-service.sh <env> <service> <image-uri> [--force]
#
# Safe to run twice: when the service already runs <image-uri>, from a task definition this script
# registered, it prints a notice and exits 0 without migrating, seeding or updating (D-M1-15). That keeps a
# duplicate push event, a re-run or a double merge from rolling the service again. FORCE_DEPLOY=true
# or --force skips the check. A task definition made by Terraform carries no marker, so the first deploy
# of an environment always runs, even when Terraform was applied with the same image tag.
#
# Names follow the Terraform modules from M1 (ecs-service): cluster docbeam-<env>-cluster, service
# and task definition family docbeam-<env>-<service>, and docbeam-<env>-<service>-migrate for the migrations.
# A service with a docbeam-<env>-<service>-seed family (platform) runs it after the migrations (Launch plan).
# Rollback: run it again with the previous image URI (see the README).
set -euo pipefail

ENV_NAME="${1:?usage: scripts/deploy-service.sh <env> <service> <image-uri> [--force]}"
SERVICE="${2:?missing service}"
IMAGE="${3:?missing image uri}"
FORCE="${FORCE_DEPLOY:-false}"
[ "${4:-}" = "--force" ] && FORCE=true
MARKER_KEY="deployed-by"
MARKER_VALUE="deploy-service.sh"

if [ "$ENV_NAME" = "prod" ] && [ "${CI:-}" != "true" ]; then
  echo "Prod is deployed only by the GitHub workflows." >&2
  exit 1
fi

REGION="${AWS_REGION:-ap-southeast-2}"
CLUSTER="docbeam-${ENV_NAME}-cluster"
NAME="docbeam-${ENV_NAME}-${SERVICE}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Already deployed? The service's current task definition must run this image and carry our marker.
if [ "$FORCE" != "true" ]; then
  CURRENT_DEF="$(aws ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$NAME" \
    --query 'services[0].taskDefinition' --output text 2>/dev/null || true)"
  if [ -n "$CURRENT_DEF" ] && [ "$CURRENT_DEF" != "None" ]; then
    CURRENT_JSON="$(aws ecs describe-task-definition --region "$REGION" --task-definition "$CURRENT_DEF" \
      --include TAGS --output json 2>/dev/null || true)"
    RUNNING_IMAGE="$(printf '%s' "$CURRENT_JSON" | jq -r '.taskDefinition.containerDefinitions[0].image // empty' 2>/dev/null || true)"
    RUNNING_MARKER="$(printf '%s' "$CURRENT_JSON" | jq -r --arg k "$MARKER_KEY" \
      '(.tags // []) | map(select(.key == $k)) | first | .value // empty' 2>/dev/null || true)"
    if [ "$RUNNING_IMAGE" = "$IMAGE" ] && [ "$RUNNING_MARKER" = "$MARKER_VALUE" ]; then
      echo "${NAME} already runs ${IMAGE}. Nothing to do (use --force or FORCE_DEPLOY=true to redeploy)."
      if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
        echo "::notice title=Deploy skipped::${NAME} already runs this image."
      fi
      exit 0
    fi
  fi
fi

# Registers a new revision of a family with the new image and returns its ARN.
register() {
  local family="$1"
  aws ecs describe-task-definition --region "$REGION" --task-definition "$family" --query taskDefinition \
    | jq --arg image "$IMAGE" '
        del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)
        | .containerDefinitions[0].image = $image' > "${TMP}/${family}.json"
  aws ecs register-task-definition --region "$REGION" --cli-input-json "file://${TMP}/${family}.json" \
    --tags "key=${MARKER_KEY},value=${MARKER_VALUE}" --query 'taskDefinition.taskDefinitionArn' --output text
}

SERVICE_TASK_DEF="$(register "$NAME")"
MIGRATE_TASK_DEF="$(register "${NAME}-migrate")"

NETWORK="$(aws ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$NAME" \
  --query 'services[0].networkConfiguration' --output json)"

echo "Running migrations for ${SERVICE}"
TASK_ARN="$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --task-definition "$MIGRATE_TASK_DEF" \
  --launch-type FARGATE --network-configuration "$NETWORK" --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE="$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
if [ "$EXIT_CODE" != "0" ]; then
  echo "Migrations failed (exit code ${EXIT_CODE}). The service was not changed." >&2
  exit 1
fi

if aws ecs describe-task-definition --region "$REGION" --task-definition "${NAME}-seed" >/dev/null 2>&1; then
  echo "Running the seed for ${SERVICE}"
  SEED_TASK_DEF="$(register "${NAME}-seed")"
  SEED_ARN="$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --task-definition "$SEED_TASK_DEF" \
    --launch-type FARGATE --network-configuration "$NETWORK" --query 'tasks[0].taskArn' --output text)"
  aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$SEED_ARN"
  SEED_CODE="$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$SEED_ARN" \
    --query 'tasks[0].containers[0].exitCode' --output text)"
  if [ "$SEED_CODE" != "0" ]; then
    echo "The seed failed (exit code ${SEED_CODE}). The service was not changed." >&2
    exit 1
  fi
fi

echo "Updating ${NAME}"
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$NAME" \
  --task-definition "$SERVICE_TASK_DEF" >/dev/null
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "$NAME"
echo "Deployed ${IMAGE} to ${NAME}"
