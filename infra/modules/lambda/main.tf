terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

# One worker Lambda inside the VPC, with its role, log group, security group and SQS triggers.
# Terraform creates it from a placeholder (zip) or from the first pushed image. The real code is deployed by
# scripts/deploy-lambda.sh, so later code changes are ignored here (D-M2-6), as the ECS services do.

locals {
  function_name = "${var.name}-${var.function}"
  is_zip        = var.package_type == "zip"
}

data "archive_file" "placeholder" {
  count = local.is_zip ? 1 : 0

  type        = "zip"
  output_path = "${path.module}/.build/${local.function_name}.zip"

  source {
    filename = "index.mjs"
    content  = <<-JS
      export const handler = async () => {
        throw new Error('Placeholder: deploy the code with scripts/deploy-lambda.sh.');
      };
    JS
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_security_group" "this" {
  name        = local.function_name
  description = "${local.function_name} Lambda: outbound only"
  vpc_id      = var.vpc_id

  tags = { Name = local.function_name }
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.this.id
  description       = "Database, internal ALB, SQS, S3 and Secrets Manager"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = local.function_name
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Logs and the network interfaces of a function in a VPC.
resource "aws_iam_role_policy_attachment" "vpc_access" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "base" {
  dynamic "statement" {
    for_each = length(var.sqs_triggers) > 0 ? [1] : []
    content {
      sid = "ConsumeQueues"
      # GetQueueUrl and ChangeMessageVisibility are for the retry gaps the handlers set (ADR-005).
      actions = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl",
        "sqs:ChangeMessageVisibility",
      ]
      resources = [for t in var.sqs_triggers : t.queue_arn]
    }
  }

  dynamic "statement" {
    for_each = length(var.secret_arns) > 0 ? [1] : []
    content {
      sid       = "ReadSecrets"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = var.secret_arns
    }
  }
}

resource "aws_iam_role_policy" "base" {
  count = length(var.sqs_triggers) > 0 || length(var.secret_arns) > 0 ? 1 : 0

  name   = "base"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.base.json
}

resource "aws_iam_role_policy" "extra" {
  count = var.policy_json == "" ? 0 : 1

  name   = "extra"
  role   = aws_iam_role.this.id
  policy = var.policy_json
}

resource "aws_lambda_function" "this" {
  function_name = local.function_name
  role          = aws_iam_role.this.arn
  description   = "DocBeam ${var.function} worker"

  package_type  = local.is_zip ? "Zip" : "Image"
  architectures = ["x86_64"]

  filename         = local.is_zip ? data.archive_file.placeholder[0].output_path : null
  source_code_hash = local.is_zip ? data.archive_file.placeholder[0].output_base64sha256 : null
  handler          = local.is_zip ? var.handler : null
  runtime          = local.is_zip ? "nodejs22.x" : null
  image_uri        = local.is_zip ? null : var.image_uri

  memory_size                    = var.memory_size
  timeout                        = var.timeout
  reserved_concurrent_executions = var.reserved_concurrency

  ephemeral_storage {
    size = var.ephemeral_storage_mb
  }

  environment {
    variables = var.environment
  }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.this.id]
  }

  depends_on = [
    aws_cloudwatch_log_group.this,
    aws_iam_role_policy_attachment.vpc_access,
    aws_iam_role_policy.base,
    aws_iam_role_policy.extra,
  ]

  lifecycle {
    ignore_changes = [filename, source_code_hash, image_uri]
  }
}

resource "aws_lambda_event_source_mapping" "sqs" {
  for_each = var.sqs_triggers

  function_name           = aws_lambda_function.this.arn
  event_source_arn        = each.value.queue_arn
  batch_size              = each.value.batch_size
  function_response_types = ["ReportBatchItemFailures"]

  dynamic "scaling_config" {
    for_each = each.value.max_concurrency == null ? [] : [each.value.max_concurrency]
    content {
      maximum_concurrency = scaling_config.value
    }
  }
}
