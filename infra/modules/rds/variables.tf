variable "name" {
  description = "Name prefix, for example docbeam-dev."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr_block" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "engine_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "16"
}

variable "instance_class" {
  description = "db.t4g.micro in dev."
  type        = string
}

variable "multi_az" {
  description = "false in dev, true in prod."
  type        = bool
}

variable "enable_rds_proxy" {
  description = "false in dev: the Free plan blocks RDS Proxy (D-M0-6). true in prod."
  type        = bool
}

variable "max_connections" {
  description = "Fixed max_connections for the instance. Null keeps the default for the instance size."
  type        = number
  default     = null
}

variable "allocated_storage_gb" {
  type    = number
  default = 20
}

variable "max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling."
  type        = number
  default     = 100
}

variable "backup_retention_days" {
  type = number
}

variable "apply_immediately" {
  description = "Apply changes now instead of in the next maintenance window."
  type        = bool
  default     = false
}

# Teardown safety (D-M0-4): dev can be destroyed and re-created at once, prod cannot lose data by accident.

variable "deletion_protection" {
  description = "false in dev, true in prod."
  type        = bool
}

variable "skip_final_snapshot" {
  description = "true in dev, false in prod."
  type        = bool
}

variable "secret_recovery_window_days" {
  description = "0 in dev (names free up at once), 30 in prod."
  type        = number
}
