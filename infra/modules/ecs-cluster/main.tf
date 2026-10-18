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

# The cluster for the three services, and the home of the one-off tasks: DB bootstrap now, migrations and the
# signing-key task from M1 (D-G11, D-M0-1).
resource "aws_ecs_cluster" "this" {
  name = "${var.name}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "db_bootstrap" {
  name              = "/docbeam/${var.name}/db-bootstrap"
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

# Execution role: pulls the image, writes logs and injects the secrets as environment variables.
resource "aws_iam_role" "db_bootstrap_execution" {
  name               = "${var.name}-db-bootstrap-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "db_bootstrap_execution" {
  role       = aws_iam_role.db_bootstrap_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "db_bootstrap_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = concat([var.master_secret_arn], values(var.app_secret_arns))
  }
}

resource "aws_iam_role_policy" "db_bootstrap_secrets" {
  name   = "read-bootstrap-secrets"
  role   = aws_iam_role.db_bootstrap_execution.id
  policy = data.aws_iam_policy_document.db_bootstrap_secrets.json
}

# The task role is empty on purpose: the script only talks to PostgreSQL.
resource "aws_iam_role" "db_bootstrap_task" {
  name               = "${var.name}-db-bootstrap-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-one-off-tasks"
  description = "One-off ECS tasks: outbound only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-one-off-tasks" }
}

resource "aws_vpc_security_group_egress_rule" "tasks_all" {
  security_group_id = aws_security_group.tasks.id
  description       = "Database, ECR, Secrets Manager and logs"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_ecs_task_definition" "db_bootstrap" {
  family                   = "${var.name}-db-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.db_bootstrap_execution.arn
  task_role_arn            = aws_iam_role.db_bootstrap_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "db-bootstrap"
    image     = "${var.db_bootstrap_image_repository_url}:${var.db_bootstrap_image_tag}"
    essential = true
    environment = [
      { name = "PGHOST", value = var.db_host },
      { name = "PGPORT", value = "5432" },
      { name = "PGDATABASE", value = "postgres" },
      { name = "PGSSLMODE", value = "verify-full" },
      { name = "PGSSLROOTCERT", value = "/etc/rds-ca-bundle.pem" },
    ]
    secrets = concat(
      [
        { name = "PGUSER", valueFrom = "${var.master_secret_arn}:username::" },
        { name = "PGPASSWORD", valueFrom = "${var.master_secret_arn}:password::" },
      ],
      [for service, arn in var.app_secret_arns : {
        name      = "${upper(service)}_APP_PASSWORD"
        valueFrom = "${arn}:password::"
      }],
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.db_bootstrap.name
        "awslogs-region"        = data.aws_region.current.region
        "awslogs-stream-prefix" = "run"
      }
    }
  }])
}
