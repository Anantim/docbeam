variable "name" {
  description = "Environment prefix, for example docbeam-dev."
  type        = string
}

variable "service" {
  description = "auth, platform or docbeam-api. Task definitions are named <name>-<service>, <name>-<service>-migrate and so on, as scripts/deploy-service.sh expects."
  type        = string
}

variable "cluster_arn" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "image" {
  description = "Full image URI for the first deploy. Later deploys register new revisions with scripts/deploy-service.sh."
  type        = string
}

variable "port" {
  type = number
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  description = "1 in dev and 2 across zones in prod (Step 1.1)."
  type        = number
}

variable "alb_security_group_id" {
  type = string
}

variable "target_group_arn" {
  type = string
}

variable "environment" {
  description = "Plain environment variables of the running service."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Environment variable name to Secrets Manager valueFrom, for the running service."
  type        = map(string)
  default     = {}
}

variable "migrate_environment" {
  description = "Plain environment variables of the migrate task."
  type        = map(string)
  default     = {}
}

variable "migrate_secrets" {
  description = "Environment variable name to valueFrom, for the migrate task."
  type        = map(string)
  default     = {}
}

variable "task_policy_json" {
  description = "Extra permissions of the running service's task role, as an IAM policy document. Empty for none."
  type        = string
  default     = ""
}

variable "one_off_tasks" {
  description = "Other one-off tasks that use the same image, for example platform seed or the auth signing key."
  type = map(object({
    command     = list(string)
    environment = map(string)
    secrets     = map(string)
    policy_json = string
  }))
  default = {}
}

variable "stop_timeout" {
  description = "Seconds the container gets between SIGTERM and SIGKILL. Fargate allows at most 120. The platform uses 120 to finish a running ingest (D-M2-17)."
  type        = number
  default     = 30
}

variable "log_retention_days" {
  type    = number
  default = 30
}
