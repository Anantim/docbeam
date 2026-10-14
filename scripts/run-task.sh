#!/usr/bin/env bash
# Runs one of a service's task definitions once, in the service's own network, and prints its log.
#
#   scripts/run-task.sh <env> <service> <task> [command...]
#
# <task> is service, migrate, seed or signing-key. It uses the service's subnets and security group. A command
# after the task name replaces the container command, for example the check from inside the network.
# Fails unless the container exits with 0.
#
# Which revision runs (D-M2-1): for service, migrate and seed, the newest revision that scripts/deploy-service.sh
# registered (it carries the tag deployed-by=deploy-service.sh). A later `terraform apply` registers revisions with
# the image `bootstrap`, which would not start, so those are passed over. If none is marked the script stops
# and says to deploy the service first. Other families (signing-key) run their latest revision, because
# they are run before the first deploy.
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
MARKER_KEY="deployed-by"
MARKER_VALUE="deploy-service.sh"

# The task definition to run: the newest marked revision for the families deploy-service.sh manages.
TASK_DEFINITION="$FAMILY"
case "$TASK" in
  service | migrate | seed)
    TASK_DEFINITION=""
    # Newest first; look at the ten newest revisions of exactly this family.
    ARNS="$(aws ecs list-task-definitions --region "$REGION" --family-prefix "$FAMILY" --status ACTIVE --sort DESC \
      --query 'taskDefinitionArns' --output text | tr '\t' '\n' | grep -E "/${FAMILY}:[0-9]+$" | head -n 10 || true)"
    for arn in $ARNS; do
      MARKER="$(aws ecs describe-task-definition --region "$REGION" --task-definition "$arn" --include TAGS \
        --query "tags[?key=='${MARKER_KEY}'].value | [0]" --output text 2>/dev/null || true)"
      if [ "$MARKER" = "$MARKER_VALUE" ]; then
        TASK_DEFINITION="$arn"
        break
      fi
    done
    if [ -z "$TASK_DEFINITION" ]; then
      echo "No revision of ${FAMILY} was registered by scripts/deploy-service.sh. Run scripts/deploy-service.sh ${ENV_NAME} ${SERVICE} <image-uri> first." >&2
      exit 1
    fi
    ;;
esac

NETWORK="$(aws ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$NAME" \
  --query 'services[0].networkConfiguration' --output json)"

OVERRIDES=()
if [ "$#" -gt 0 ]; then
  COMMAND_JSON="$(python3 -c 'import json, sys; print(json.dumps(sys.argv[1:]))' "$@")"
  OVERRIDES=(--overrides "{\"containerOverrides\":[{\"name\":\"app\",\"command\":${COMMAND_JSON}}]}")
fi

TASK_ARN="$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --task-definition "$TASK_DEFINITION" \
  --launch-type FARGATE --network-configuration "$NETWORK" "${OVERRIDES[@]}" \
  --query 'tasks[0].taskArn' --output text)"
TASK_ID="${TASK_ARN##*/}"
echo "Started ${TASK_DEFINITION##*/} task ${TASK_ID}"

aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE="$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)"

echo "--- task log"
aws logs get-log-events --region "$REGION" --log-group-name "$LOG_GROUP" \
  --log-stream-name "${TASK}/app/${TASK_ID}" --query 'events[].message' --output text | tr '\t' '\n' || true
echo "--- exit code: ${EXIT_CODE}"

[ "$EXIT_CODE" = "0" ]
