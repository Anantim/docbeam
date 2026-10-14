variable "name" {
  description = "Name prefix, for example docbeam-dev."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "db_host" {
  description = "Direct address of the database instance. The bootstrap needs the instance, not the proxy."
  type        = string
}

variable "master_secret_arn" {
  description = "RDS-managed master login secret."
  type        = string
}

variable "app_secret_arns" {
  description = "App-role secrets keyed by auth, platform, docbeam. Only the password is read."
  type        = map(string)
}

variable "db_bootstrap_image_repository_url" {
  description = "ECR repository URL of the db-bootstrap image."
  type        = string
}

variable "db_bootstrap_image_tag" {
  description = "Image tag to run. The db-bootstrap repository is mutable, and scripts/push-image.sh moves this tag."
  type        = string
  default     = "bootstrap"
}
