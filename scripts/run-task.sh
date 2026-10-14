#!/usr/bin/env bash
# Runs one of a service's task definitions once, in the service's own network, and prints its log.
#
#   scripts/run-task.sh <env> <service> <task> [command...]
#
# <task> is service, migrate, seed or signing-key. It uses the latest revision of the family
# docbeam-<env>-<service>[-<task>] and the service's subnets and security group. A command after the
# task name replaces the container command, for example the check from inside the network.
# Fails unless the container exits with 0.
set -euo pipefail

ENV_NAME="${1:?usage: scripts/run-task.sh <env> <service> <task> [command...]}"
SERVICE="${2:?missing service}"
TASK="${3:?missing task: service, migrate, seed or signing-key}"
shift 3

if [ "$ENV_NAME" = "prod" ] && [ "${CI:-}" != "true" ]; then
  echo "Prod tasks run only from the GitHub workflows." >&2
  exit 1
fi

REGION="${AWS_REGION:-ap-southeast-2}"
CLUSTER="docbeam-${ENV_NAME}-cluster"
NAME="docbeam-${ENV_NAME}-${SERVICE}"
FAMILY="$NAME"
[ "$TASK" = "service" ] || FAMILY="${NAME}-${TASK}"
LOG_GROUP="/docbeam/docbeam-${ENV_NAME}/${SERVICE}"

NETWORK="$(aws ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$NAME" \
  --query 'services[0].networkConfiguration' --output json)"

OVERRIDES=()
if [ "$#" -gt 0 ]; then
  OVERRIDES=(--overrides "$(jq -nc --args '{containerOverrides: [{name: "app", command: $ARGS.positional}]}' "$@")")
fi

TASK_ARN="$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --task-definition "$FAMILY" \
  --launch-type FARGATE --network-configuration "$NETWORK" "${OVERRIDES[@]}" \
  --query 'tasks[0].taskArn' --output text)"
TASK_ID="${TASK_ARN##*/}"
echo "Started ${FAMILY} task ${TASK_ID}"

aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE="$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)"

echo "--- task log"
aws logs get-log-events --region "$REGION" --log-group-name "$LOG_GROUP" \
  --log-stream-name "${TASK}/app/${TASK_ID}" --query 'events[].message' --output text | tr '\t' '\n' || true
echo "--- exit code: ${EXIT_CODE}"

[ "$EXIT_CODE" = "0" ]
