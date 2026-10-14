#!/usr/bin/env bash
# Runs the DB bootstrap as a one-off ECS task: three databases, six roles, citext (D-G11).
#
#   scripts/run-db-bootstrap.sh <env>
#
# Safe to run again. Needs the db-bootstrap image pushed first (scripts/push-image.sh).
# Prints the task log and fails if the container did not exit with 0.
set -euo pipefail

ENV_NAME="${1:?usage: scripts/run-db-bootstrap.sh <env>}"

if [ "$ENV_NAME" = "prod" ] && [ "${CI:-}" != "true" ]; then
  echo "The prod bootstrap runs only from the GitHub workflows." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-2}"
TF="terraform -chdir=${ROOT}/infra/envs/${ENV_NAME}"

CLUSTER="$($TF output -raw ecs_cluster_name)"
TASK_DEFINITION="$($TF output -raw db_bootstrap_task_definition)"
LOG_GROUP="$($TF output -raw db_bootstrap_log_group)"
SECURITY_GROUP="$($TF output -raw one_off_task_security_group_id)"
SUBNETS="$($TF output -json private_subnet_ids | jq -r 'join(",")')"

TASK_ARN="$(aws ecs run-task --region "$REGION" \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEFINITION" \
  --launch-type FARGATE \
  --platform-version LATEST \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SECURITY_GROUP}],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)"
TASK_ID="${TASK_ARN##*/}"
echo "Started task ${TASK_ID}"

aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"

EXIT_CODE="$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)"

echo "--- task log"
aws logs get-log-events --region "$REGION" --log-group-name "$LOG_GROUP" \
  --log-stream-name "run/db-bootstrap/${TASK_ID}" --query 'events[].message' --output text | tr '\t' '\n' || true
echo "--- exit code: ${EXIT_CODE}"

[ "$EXIT_CODE" = "0" ]
