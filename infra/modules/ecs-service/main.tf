terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

data "aws_region" "current" {}

locals {
  family = "${var.name}-${var.service}"

  # Every secret ARN the execution role must read. valueFrom is "<arn>" or "<arn>:<json key>::".
  value_from = concat(
    values(var.secrets),
    values(var.migrate_secrets),
    flatten([for t in values(var.one_off_tasks) : values(t.secrets)]),
  )
  secret_arns = distinct([for v in local.value_from : join(":", slice(split(":", v), 0, 7))])

  runtime = {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/docbeam/${var.name}/${var.service}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# One execution role per service: pulls the image, writes logs, injects the secrets.
resource "aws_iam_role" "execution" {
  name               = "${local.family}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.secret_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# The task role of the running service: empty unless the service needs AWS calls (platform: its bucket).
resource "aws_iam_role" "task" {
  name               = "${local.family}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task" {
  count = var.task_policy_json == "" ? 0 : 1

  name   = "service"
  role   = aws_iam_role.task.id
  policy = var.task_policy_json
}

# The migrate task uses a role with no permissions: it only talks to PostgreSQL.
resource "aws_iam_role" "migrate_task" {
  name               = "${local.family}-migrate-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_security_group" "service" {
  name        = local.family
  description = "${var.service}: inbound from the internal ALB only"
  vpc_id      = var.vpc_id

  tags = { Name = local.family }
}

resource "aws_vpc_security_group_ingress_rule" "from_alb" {
  security_group_id            = aws_security_group.service.id
  description                  = "ALB listener to the service port"
  referenced_security_group_id = var.alb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.port
  to_port                      = var.port
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.service.id
  description       = "Database, ECR, Secrets Manager, S3, logs and the other services"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

locals {
  log_options = {
    "awslogs-group"  = aws_cloudwatch_log_group.this.name
    "awslogs-region" = data.aws_region.current.region
  }
}

resource "aws_ecs_task_definition" "service" {
  family                   = local.family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = local.runtime.cpu_architecture
    operating_system_family = local.runtime.operating_system_family
  }

  # The service container is always first: scripts/deploy-service.sh swaps containerDefinitions[0].image.
  container_definitions = jsonencode([{
    name         = "app"
    image        = var.image
    essential    = true
    portMappings = [{ containerPort = var.port, protocol = "tcp" }]
    environment  = [for k, v in var.environment : { name = k, value = v }]
    secrets      = [for k, v in var.secrets : { name = k, valueFrom = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options   = merge(local.log_options, { "awslogs-stream-prefix" = "service" })
    }
  }])
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.family}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.migrate_task.arn

  runtime_platform {
    cpu_architecture        = local.runtime.cpu_architecture
    operating_system_family = local.runtime.operating_system_family
  }

  container_definitions = jsonencode([{
    name        = "app"
    image       = var.image
    essential   = true
    command     = ["node", "dist/migrate.js"]
    environment = [for k, v in var.migrate_environment : { name = k, value = v }]
    secrets     = [for k, v in var.migrate_secrets : { name = k, valueFrom = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options   = merge(local.log_options, { "awslogs-stream-prefix" = "migrate" })
    }
  }])
}

# Other one-off tasks on the same image. Each has its own role, so only the signing-key task can write the key.
resource "aws_iam_role" "one_off" {
  for_each = var.one_off_tasks

  name               = "${local.family}-${each.key}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "one_off" {
  for_each = { for k, t in var.one_off_tasks : k => t if t.policy_json != "" }

  name   = "task"
  role   = aws_iam_role.one_off[each.key].id
  policy = each.value.policy_json
}

resource "aws_ecs_task_definition" "one_off" {
  for_each = var.one_off_tasks

  family                   = "${local.family}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.one_off[each.key].arn

  runtime_platform {
    cpu_architecture        = local.runtime.cpu_architecture
    operating_system_family = local.runtime.operating_system_family
  }

  container_definitions = jsonencode([{
    name        = "app"
    image       = var.image
    essential   = true
    command     = each.value.command
    environment = [for k, v in each.value.environment : { name = k, value = v }]
    secrets     = [for k, v in each.value.secrets : { name = k, valueFrom = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options   = merge(local.log_options, { "awslogs-stream-prefix" = each.key })
    }
  }])
}

resource "aws_ecs_service" "this" {
  name            = local.family
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.service.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # A deploy that never turns healthy rolls back by itself (TDD Rollback).
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  health_check_grace_period_seconds = 60

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "app"
    container_port   = var.port
  }

  # scripts/deploy-service.sh owns the task definition after the first apply.
  lifecycle {
    ignore_changes = [task_definition]
  }
}
