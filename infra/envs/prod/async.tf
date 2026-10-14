# The asynchronous half (M2): queues, the five worker Lambdas, alarms and the Sweeper's schedules.
# Resource blocks live in the modules. Code is deployed by scripts/deploy-lambda.sh (D-M2-6).

variable "alarm_email" {
  description = "Where alarm emails go. CI passes it from the repository variable ALARM_EMAIL (TF_VAR_alarm_email). Confirm the SNS subscription once."
  type        = string
}

variable "upload_events_image_tag" {
  description = "Tag of the Upload Events image Terraform starts the function from. Push the image first (scripts/push-image.sh); later builds are deployed by scripts/deploy-lambda.sh and ignored here."
  type        = string
  default     = "bootstrap"
}

locals {
  db_env = {
    DB_HOST       = module.rds.lambda_db_host
    DB_NAME       = "docbeam_db"
    DB_SECRET_ARN = module.rds.app_secret_arns["docbeam"]
  }
  db_secret_arns  = [module.rds.app_secret_arns["docbeam"]]
  delivery_secret = module.secrets.client_secret_arns["delivery-worker"]

  # The Object Store's bucket policy allows these roles and no others (ADR-003).
  object_store_objects = "${module.s3.object_store_arn}/*"
}

module "sqs" {
  source = "../../modules/sqs"

  name       = local.name
  account_id = local.account_id
  # Built from the name, so the queue policy does not wait for the bucket's notification (which waits for the queue).
  object_store_bucket_arn = "arn:aws:s3:::${local.name}-object-store-${local.account_id}"
}

# Concurrency follows the connection budget in D-M0-6 and D-M2-9: Delivery 50, Upload Events 10, Fan-out 2,
# DLQ Consumer 2 (reserved), Sweeper 1 (reserved). Each opens at most one database connection.

module "upload_events" {
  source = "../../modules/lambda"

  name         = local.name
  function     = "upload-events"
  package_type = "image"
  image_uri    = "${module.ecr.repository_urls["upload-events"]}:${var.upload_events_image_tag}"

  # The most a new account allows, with room for a 1 GB file and ClamAV (ADR-016).
  memory_size          = 3008
  ephemeral_storage_mb = 10240
  timeout              = 600

  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.private_subnet_ids
  environment = local.db_env
  secret_arns = local.db_secret_arns

  sqs_triggers = {
    upload-events = { queue_arn = module.sqs.queue_arns["upload-events"], max_concurrency = 10 }
  }

  policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:GetObjectTagging", "s3:PutObjectTagging", "s3:DeleteObject"]
      Resource = local.object_store_objects
    }]
  })
}

module "fanout" {
  source = "../../modules/lambda"

  name     = local.name
  function = "fanout"

  timeout     = 60
  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.private_subnet_ids
  environment = merge(local.db_env, { TASK_QUEUE_URL = module.sqs.queue_urls["task"] })
  secret_arns = local.db_secret_arns

  sqs_triggers = {
    job = { queue_arn = module.sqs.queue_arns["job"], max_concurrency = 2 }
  }

  policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = module.sqs.queue_arns["task"]
    }]
  })
}

module "delivery" {
  source = "../../modules/lambda"

  name     = local.name
  function = "delivery"

  memory_size = 1024
  timeout     = 120
  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.private_subnet_ids
  environment = merge(local.db_env, {
    OBJECT_STORE_BUCKET               = module.s3.object_store_bucket
    AUTH_URL                          = "${local.alb_url}:3001"
    PLATFORM_URL                      = "${local.alb_url}:3002"
    CLIENT_SECRET_DELIVERY_WORKER_ARN = local.delivery_secret
  })
  secret_arns = concat(local.db_secret_arns, [local.delivery_secret])

  sqs_triggers = {
    task = { queue_arn = module.sqs.queue_arns["task"], max_concurrency = 50 }
  }

  policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = local.object_store_objects
    }]
  })
}

module "dlq_consumer" {
  source = "../../modules/lambda"

  name     = local.name
  function = "dlq"

  timeout              = 60
  reserved_concurrency = 2
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  environment          = local.db_env
  secret_arns          = local.db_secret_arns

  sqs_triggers = {
    job           = { queue_arn = module.sqs.queue_arns["job-dlq"], max_concurrency = 2 }
    task          = { queue_arn = module.sqs.queue_arns["task-dlq"], max_concurrency = 2 }
    upload-events = { queue_arn = module.sqs.queue_arns["upload-events-dlq"], max_concurrency = 2 }
  }
}

module "sweeper" {
  source = "../../modules/lambda"

  name     = local.name
  function = "sweeper"

  timeout              = 300
  reserved_concurrency = 1
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  environment = merge(local.db_env, {
    JOB_QUEUE_URL       = module.sqs.queue_urls["job"]
    OBJECT_STORE_BUCKET = module.s3.object_store_bucket
  })
  secret_arns = local.db_secret_arns

  policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = module.sqs.queue_arns["job"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:AbortMultipartUpload"]
        Resource = local.object_store_objects
      },
    ]
  })
}

module "scheduler" {
  source = "../../modules/scheduler"

  name         = local.name
  function_arn = module.sweeper.function_arn
}

module "alarms" {
  source = "../../modules/alarms"

  name        = local.name
  alarm_email = var.alarm_email

  delivery_function_name = module.delivery.function_name
  dlq_names = {
    job           = module.sqs.queue_names["job-dlq"]
    task          = module.sqs.queue_names["task-dlq"]
    upload-events = module.sqs.queue_names["upload-events-dlq"]
  }
}
