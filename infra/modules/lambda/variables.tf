variable "name" {
  description = "Environment prefix, for example docbeam-dev."
  type        = string
}

variable "function" {
  description = "Short name: fanout, delivery, upload-events, dlq or sweeper. The function is named <name>-<function>, as scripts/deploy-lambda.sh expects."
  type        = string
}

variable "package_type" {
  description = "zip for the bundled workers, image for Upload Events (it carries ClamAV, ADR-016)."
  type        = string
  default     = "zip"

  validation {
    condition     = contains(["zip", "image"], var.package_type)
    error_message = "package_type must be zip or image."
  }
}

variable "image_uri" {
  description = "Image to start from when package_type is image. Later deploys come from scripts/deploy-lambda.sh (D-M2-6)."
  type        = string
  default     = null
}

variable "handler" {
  type    = string
  default = "index.handler"
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  type = number
}

variable "ephemeral_storage_mb" {
  type    = number
  default = 512
}

variable "reserved_concurrency" {
  description = "Reserved concurrency, or -1 for none. Keeps the dev connection budget true (D-M0-6, D-M2-9)."
  type        = number
  default     = -1
}

variable "environment" {
  description = "Plain environment variables. Secrets are passed as ARNs and read at runtime (D-M2-5)."
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "secret_arns" {
  description = "Secrets the function may read."
  type        = list(string)
  default     = []
}

variable "policy_json" {
  description = "Extra permissions as an IAM policy document. Empty for none."
  type        = string
  default     = ""
}

variable "sqs_triggers" {
  description = "Queues that trigger the function. Batch size 1 with ReportBatchItemFailures everywhere (Step 2.3)."
  type = map(object({
    queue_arn       = string
    batch_size      = optional(number, 1)
    max_concurrency = optional(number)
  }))
  default = {}
}

variable "log_retention_days" {
  type    = number
  default = 30
}
