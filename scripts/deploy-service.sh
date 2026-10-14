#!/usr/bin/env bash
# Deploys one ECS service from an image that is already in ECR: runs its migrations as a one-off
# task, then points the service at a new task definition and waits for it to settle.
#
#   scripts/deploy-service.sh <env> <service> <image-uri>
#
# Names follow the Terraform modules from M1 (ecs-service): cluster docbeam-<env>-cluster, service
# and task definition family docbeam-<env>-<service>, and docbeam-<env>-<service>-migrate for the migrations.
# A service with a docbeam-<env>-<service>-seed family (platform) runs it after the migrations (Launch plan).
# Rollback: run it again with the previous image URI (see the README).
set -euo pipefail

ENV_NAME="${1:?usage: scripts/deploy-service.sh <env> <service> <image-uri>}"
SERVICE="${2:?missing service}"
IMAGE="${3:?missing image uri}"

if [ "$ENV_NAME" = "prod" ] && [ "${CI:-}" != "true" ]; then
  echo "Prod is deployed only by the GitHub workflows." >&2
  exit 1
fi

REGION="${AWS_REGION:-ap-southeast-2}"
CLUSTER="docbeam-${ENV_NAME}-cluster"
NAME="docbeam-${ENV_NAME}-${SERVICE}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Registers a new revision of a family with the new image and returns its ARN.
register() {
  local family="$1"
  aws ecs describe-task-definition --region "$REGION" --task-definition "$family" --query taskDefinition \
    | jq --arg image "$IMAGE" '
        del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)
        | .containerDefinitions[0].image = $image' > "${TMP}/${family}.json"
  aws ecs register-task-definition --region "$REGION" --cli-input-json "file://${TMP}/${family}.json" \
    --query 'taskDefinition.taskDefinitionArn' --output text
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
